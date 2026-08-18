import { useState, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, Pressable, ScrollView, ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { read as xlsxRead, utils as xlsxUtils } from 'xlsx';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft, FileSpreadsheet, Upload, CheckCircle2,
  AlertCircle, RefreshCw, Plus, Trash2, Square, CheckSquare,
  Fuel, Edit3,
} from 'lucide-react-native';
import { supabase } from '@/client/supabase';
import { appEvents, EVT_OIL_IMPORTED } from '@/lib/events';

// ── 类型 ──────────────────────────────────────────────────────────────
type VehicleType = 'gasoline' | 'diesel' | 'lng';

interface ExcelRow {
  seq_no: number;
  unit: string | null;
  plate_number: string;
  vehicle_model: string | null;
  body_color: string | null;
  fuel_type: string | null;
  oil_card: string | null;
  driver_name: string | null;
  gas_grade: string | null;
  remark: string | null;
}

interface DbRow extends ExcelRow { id: number; }

interface DiffItem {
  type: 'add' | 'delete';
  seq_no: number;
  plate_number: string;
  detail: string;
  excelRow?: ExcelRow;
}

// Sheet 解析结果
interface SheetResult {
  type: VehicleType;
  rows: ExcelRow[];
  skipped: number; // 油品不匹配被过滤的行数
}

// ── 常量 ──────────────────────────────────────────────────────────────
const TABLE_MAP: Record<VehicleType, string> = {
  gasoline: 'gasoline_vehicles',
  diesel: 'diesel_vehicles',
  lng: 'lng_vehicles',
};

const TYPE_LABEL: Record<VehicleType, string> = {
  gasoline: '汽油车',
  diesel: '柴油车',
  lng: 'LNG车',
};

/** 唯一 key：车型:车牌 */
const diffKey = (type: VehicleType, plate: string) => `${type}:${plate}`;

/** 根据 sheet 名判断车辆类型 */
function detectSheetType(sheetName: string): VehicleType | null {
  if (sheetName.includes('汽油')) return 'gasoline';
  if (sheetName.includes('柴油')) return 'diesel';
  if (sheetName.includes('LNG') || sheetName.includes('lng') || sheetName.includes('天然气')) return 'lng';
  return null;
}

/** 每种车型对应的合法油品关键词 */
const FUEL_KEYWORDS: Record<VehicleType, string[]> = {
  gasoline: ['汽油'],
  diesel: ['柴油'],
  lng: ['lng', 'LNG', '天然气', '液化'],
};

/** 判断某行的油品是否与 Sheet 类型匹配
 *  - LNG Sheet：不做过滤，全部保留（LNG 车的油品字段格式不统一）
 *  - 汽油/柴油 Sheet：油品为空视为匹配；有值则必须包含对应关键词
 */
function isFuelMatch(fuelType: string | null, type: VehicleType): boolean {
  if (type === 'lng') return true; // LNG 表不按油品字段过滤
  if (!fuelType) return true;      // 汽油/柴油表：油品为空视为合法
  const keywords = FUEL_KEYWORDS[type];
  return keywords.some((kw) => fuelType.includes(kw));
}

/**
 * 解析单个 Sheet 数据
 * 第1行=大标题（跳过），第2行=表头，第3行起=数据
 */
function parseSheet(
  rawRows: Record<string, unknown>[],
  type: VehicleType,
): { rows: ExcelRow[]; skipped: number } {
  const results: ExcelRow[] = [];
  let skipped = 0;

  for (const raw of rawRows) {
    const plate = strVal(raw['车牌号']);
    if (!plate) continue;

    const fuelType = strVal(raw['所用油品']) ?? defaultFuelType(type);
    if (!isFuelMatch(fuelType, type)) { skipped++; continue; }

    const seq = numVal(raw['序号']);
    const oilCard = strVal(raw['所用油卡']);

    results.push({
      seq_no: seq ?? 0,
      unit: strVal(raw['单位']),
      plate_number: plate,
      vehicle_model: strVal(raw['车型']),
      body_color: strVal(raw['车身颜色']),
      fuel_type: fuelType,
      oil_card: oilCard,
      driver_name: strVal(raw['驾驶员']) ?? strVal(raw['司机']),
      gas_grade: type === 'gasoline' ? (strVal(raw['汽油标号']) ?? strVal(raw['油品标号'])) : null,
      remark: type === 'lng' ? strVal(raw['备注']) : null,
    });
  }

  results.forEach((r, i) => { r.seq_no = i + 1; });
  return { rows: results, skipped };
}

function strVal(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function numVal(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function defaultFuelType(type: VehicleType): string {
  if (type === 'gasoline') return '汽油';
  if (type === 'diesel') return '柴油';
  return 'LNG';
}

// ── 油价导入类型 ──────────────────────────────────────────────────────
interface OilPriceExcelRow {
  city: string;
  p92: string;
  p95: string;
  p98: string;
  p0: string;
}

interface OilPriceDbRow {
  id: number;
  city: string;
  p92: string;
  p95: string;
  p98: string;
  p0: string;
}

type OilPriceDiffType = 'add' | 'update' | 'same';

interface OilPriceDiffItem {
  diffType: OilPriceDiffType;
  city: string;
  excelRow: OilPriceExcelRow;
  dbRow?: OilPriceDbRow;
  changedFields?: string[]; // 哪些价格字段有差异
}

/** 解析油价 Excel（格式：地区/92#汽油/95#汽油/98#汽油/0#柴油） */
function parseOilPriceSheet(rawRows: Record<string, unknown>[]): OilPriceExcelRow[] {
  const results: OilPriceExcelRow[] = [];
  for (const raw of rawRows) {
    const city = strVal(raw['地区']);
    if (!city) continue;
    const p92  = strVal(raw['92#汽油']) ?? '';
    const p95  = strVal(raw['95#汽油']) ?? '';
    const p98  = strVal(raw['98#汽油']) ?? '';
    const p0   = strVal(raw['0#柴油'])  ?? '';
    if (!p92 && !p95 && !p98 && !p0) continue;
    results.push({ city, p92, p95, p98, p0 });
  }
  return results;
}

/** 与数据库比对，生成差异列表（以 Excel 为准） */
function diffOilPrices(excelRows: OilPriceExcelRow[], dbRows: OilPriceDbRow[]): OilPriceDiffItem[] {
  const dbMap = new Map(dbRows.map((r) => [r.city, r]));
  const diffs: OilPriceDiffItem[] = [];

  for (const ex of excelRows) {
    const db = dbMap.get(ex.city);
    if (!db) {
      diffs.push({ diffType: 'add', city: ex.city, excelRow: ex });
    } else {
      const changed: string[] = [];
      if (ex.p92 && ex.p92 !== db.p92) changed.push('92#');
      if (ex.p95 && ex.p95 !== db.p95) changed.push('95#');
      if (ex.p98 && ex.p98 !== db.p98) changed.push('98#');
      if (ex.p0  && ex.p0  !== db.p0 ) changed.push('0#柴');
      if (changed.length > 0) {
        diffs.push({ diffType: 'update', city: ex.city, excelRow: ex, dbRow: db, changedFields: changed });
      } else {
        diffs.push({ diffType: 'same', city: ex.city, excelRow: ex, dbRow: db });
      }
    }
  }
  return diffs;
}

// ── 组件 ──────────────────────────────────────────────────────────────
export default function ImportExcelPage() {
  const router = useRouter();

  // ── Web 文件 input refs（渲染在 DOM 里，onPress 同步 .click() 绕过浏览器手势限制） ──
  const vehicleInputRef = useRef<HTMLInputElement | null>(null);
  const oilInputRef     = useRef<HTMLInputElement | null>(null);

  // ── Native：用 DocumentPicker 选文件并读取 ArrayBuffer ──
  const pickNative = async (): Promise<{ name: string; buf: ArrayBuffer } | null> => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel', '*/*'],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return null;
    const asset = result.assets[0];
    if (!asset.name.match(/\.(xlsx|xls)$/i)) { setError('请选择 .xlsx 或 .xls 文件'); return null; }
    const { fetch: expoFetch } = await import('expo/fetch');
    const resp = await expoFetch(asset.uri);
    return { name: asset.name, buf: await resp.arrayBuffer() };
  };

  // ── 导入模式：vehicle=车辆导入  oilprice=油价导入 ──
  const [importMode, setImportMode] = useState<'vehicle' | 'oilprice' | null>(null);

  const [step, setStep] = useState<'pick' | 'preview' | 'done'>('pick');
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');

  const [sheetResults, setSheetResults] = useState<SheetResult[]>([]);
  const [sheetDiffs, setSheetDiffs] = useState<Map<VehicleType, DiffItem[]>>(new Map());
  const [dbRowsMap, setDbRowsMap] = useState<Map<VehicleType, DbRow[]>>(new Map());
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [resultMsg, setResultMsg] = useState('');

  // ── 油价导入专用状态 ──
  const [oilDiffs, setOilDiffs] = useState<OilPriceDiffItem[]>([]);
  const [oilSelectedCities, setOilSelectedCities] = useState<Set<string>>(new Set());
  const [oilTotalRows, setOilTotalRows] = useState(0);
  const allKeys = useMemo(() => {
    const keys: string[] = [];
    sheetDiffs.forEach((diffs, type) => diffs.forEach((d) => keys.push(diffKey(type, d.plate_number))));
    return keys;
  }, [sheetDiffs]);

  const isAllSelected = allKeys.length > 0 && allKeys.every((k) => selectedKeys.has(k));
  const selectedCount = selectedKeys.size;

  const toggleKey = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (isAllSelected) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(allKeys));
    }
  };

  // 按车型全选/取消该车型
  const toggleTypeAll = (type: VehicleType, diffs: DiffItem[]) => {
    const typeKeys = diffs.map((d) => diffKey(type, d.plate_number));
    const allTypeSelected = typeKeys.every((k) => selectedKeys.has(k));
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (allTypeSelected) { typeKeys.forEach((k) => next.delete(k)); }
      else { typeKeys.forEach((k) => next.add(k)); }
      return next;
    });
  };

  useFocusEffect(useCallback(() => {
    setImportMode(null);
    setStep('pick');
    setFileName('');
    setError('');
    setSheetResults([]);
    setSheetDiffs(new Map());
    setDbRowsMap(new Map());
    setSelectedKeys(new Set());
    setResultMsg('');
    setOilDiffs([]);
    setOilSelectedCities(new Set());
    setOilTotalRows(0);
  }, []));

  // ── 油价：选文件 + 解析 + 与数据库比对 ──
  const handlePickOilFile = async () => {
    setError('');
    if (process.env.EXPO_OS === 'web') { oilInputRef.current?.click(); return; }
    try {
      const picked = await pickNative();
      if (!picked) return;
      setFileName(picked.name);
      setLoading(true);
      await processOilBuf(picked.name, picked.buf);
    } catch (e) {
      setError('文件解析失败：' + (e instanceof Error ? e.message : String(e)));
    } finally { setLoading(false); }
  };

  // ── 油价解析核心逻辑（Web/Native 共用） ──
  const processOilBuf = async (name: string, buf: ArrayBuffer) => {
    setFileName(name);
    setLoading(true);
    try {
      const workbook = xlsxRead(buf, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rawRows = xlsxUtils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
      const excelRows = parseOilPriceSheet(rawRows);
      if (excelRows.length === 0) {
        setError('未解析到有效数据，请确认表头：地区 / 92#汽油 / 95#汽油 / 98#汽油 / 0#柴油');
        return;
      }
      setOilTotalRows(excelRows.length);
      const { data: dbData, error: dbErr } = await supabase.from('oil_prices').select('id,city,p92,p95,p98,p0');
      if (dbErr) throw new Error('读取数据库失败：' + dbErr.message);
      const diffs = diffOilPrices(excelRows, (dbData ?? []) as OilPriceDbRow[]);
      setOilDiffs(diffs);
      setOilSelectedCities(new Set(diffs.filter((d) => d.diffType !== 'same').map((d) => d.city)));
      setStep('preview');
    } catch (e) {
      setError('文件解析失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  };

  // ── 油价：执行更新（通过 Edge Function 用 service_role 写入，绕过 RLS） ──
  const handleApplyOil = async () => {
    const toApply = oilDiffs.filter((d) => d.diffType !== 'same' && oilSelectedCities.has(d.city));
    if (toApply.length === 0) { setError('请至少选择一条变更记录'); return; }
    setApplying(true);
    setError('');
    let addCnt = 0, updCnt = 0;
    try {
      const rows = toApply.map((d) => ({
        city: d.city,
        p92: d.excelRow.p92,
        p95: d.excelRow.p95,
        p98: d.excelRow.p98,
        p0:  d.excelRow.p0,
      }));

      const { data, error: efErr } = await supabase.functions.invoke('oilprice-import', {
        body: { rows },
      });
      if (efErr) throw new Error('调用失败：' + efErr.message);
      if (data?.error) throw new Error('写入失败：' + data.error);

      toApply.forEach((d) => { if (d.diffType === 'add') addCnt++; else updCnt++; });
      // 通知首页立即刷新油价，然后跳回首页
      appEvents.emit(EVT_OIL_IMPORTED);
      setResultMsg(`✅ 油价更新完成：新增 ${addCnt} 城市，修改 ${updCnt} 城市`);
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新失败，请重试');
    } finally {
      setApplying(false);
    }
  };

  // ── 油价：全选/取消全选 ──
  const oilChangedCities = oilDiffs.filter((d) => d.diffType !== 'same').map((d) => d.city);
  const isOilAllSelected = oilChangedCities.length > 0 && oilChangedCities.every((c) => oilSelectedCities.has(c));
  const toggleOilAll = () => {
    if (isOilAllSelected) setOilSelectedCities(new Set());
    else setOilSelectedCities(new Set(oilChangedCities));
  };
  const toggleOilCity = (city: string) => {
    setOilSelectedCities((prev) => {
      const next = new Set(prev);
      if (next.has(city)) next.delete(city); else next.add(city);
      return next;
    });
  };

  // ── 选文件并解析所有 Sheet（车辆导入） ──
  const handlePickFile = () => {
    setError('');
    if (process.env.EXPO_OS === 'web') { vehicleInputRef.current?.click(); return; }
    // Native 路径
    (async () => {
      try {
        const picked = await pickNative();
        if (!picked) return;
        setFileName(picked.name);
        setLoading(true);
        await processVehicleBuf(picked.buf);
      } catch (e) {
        setError('文件解析失败：' + (e instanceof Error ? e.message : String(e)));
      } finally { setLoading(false); }
    })();
  };

  // ── 车辆解析核心逻辑（Web/Native 共用） ──
  const processVehicleBuf = async (buf: ArrayBuffer) => {
      const workbook = xlsxRead(buf, { type: 'array' });
      const parsed: SheetResult[] = [];
      for (const sheetName of workbook.SheetNames) {
        const type = detectSheetType(sheetName);
        if (!type) continue;
        const sheet = workbook.Sheets[sheetName];
        const rawRows = xlsxUtils.sheet_to_json<Record<string, unknown>>(
          sheet, { defval: null, range: 1 }
        );
        const { rows, skipped } = parseSheet(rawRows, type);
        if (rows.length > 0) parsed.push({ type, rows, skipped });
      }

      if (parsed.length === 0) {
        setError('未识别到有效 Sheet（需包含"汽油"/"柴油"/"LNG"的 Sheet 名称）');
        setLoading(false);
        return;
      }

      setSheetResults(parsed);

      const types = parsed.map((s) => s.type);
      const dbFetches = await Promise.all(
        types.map((t) =>
          supabase.from(TABLE_MAP[t]).select('*').order('seq_no').then((r) => ({ type: t, data: r.data ?? [] }))
        )
      );

      const newDbMap = new Map<VehicleType, DbRow[]>();
      dbFetches.forEach(({ type, data }) => newDbMap.set(type, data as DbRow[]));
      setDbRowsMap(newDbMap);

      const newDiffsMap = new Map<VehicleType, DiffItem[]>();
      const newSelectedKeys = new Set<string>();

      for (const { type, rows: excelRows } of parsed) {
        const db = newDbMap.get(type) ?? [];
        const excelMap = new Map(excelRows.map((r) => [r.plate_number, r]));
        const dbMap = new Map(db.map((r) => [r.plate_number, r]));
        const diffs: DiffItem[] = [];

        for (const [plate, row] of excelMap) {
          if (!dbMap.has(plate)) {
            const key = diffKey(type, plate);
            diffs.push({ type: 'add', seq_no: row.seq_no, plate_number: plate, detail: '新增', excelRow: row });
            newSelectedKeys.add(key);
          }
        }
        for (const [plate, dbRow] of dbMap) {
          if (!excelMap.has(plate)) {
            const key = diffKey(type, plate);
            diffs.push({ type: 'delete', seq_no: dbRow.seq_no, plate_number: plate, detail: '不在新表中' });
            newSelectedKeys.add(key);
          }
        }
        diffs.sort((a, b) => a.seq_no - b.seq_no);
        newDiffsMap.set(type, diffs);
      }

      setSheetDiffs(newDiffsMap);
      setSelectedKeys(newSelectedKeys);
      setStep('preview');
  };

  // ── 执行更新（只执行被选中的条目） ──
  const handleApply = async () => {
    if (selectedCount === 0) { setError('请至少选择一条变更记录'); return; }
    setApplying(true);
    setError('');
    let totalAdd = 0, totalDelete = 0;

    try {
      for (const { type, rows: excelRows } of sheetResults) {
        const table = TABLE_MAP[type];
        const diffs = sheetDiffs.get(type) ?? [];
        const db = dbRowsMap.get(type) ?? [];
        const dbMap = new Map(db.map((r) => [r.plate_number, r]));

        // 只处理选中的条目
        const selected = diffs.filter((d) => selectedKeys.has(diffKey(type, d.plate_number)));

        const toDelete = selected.filter((d) => d.type === 'delete');
        if (toDelete.length > 0) {
          const { error: err } = await supabase.from(table).delete()
            .in('plate_number', toDelete.map((d) => d.plate_number));
          if (err) throw new Error(`${TYPE_LABEL[type]} 删除失败：${err.message}`);
          totalDelete += toDelete.length;
        }

        const toAdd = selected.filter((d) => d.type === 'add' && d.excelRow);
        if (toAdd.length > 0) {
          const { error: err } = await supabase.from(table)
            .insert(toAdd.map((d) => buildPayload(d.excelRow!, type)));
          if (err) throw new Error(`${TYPE_LABEL[type]} 新增失败：${err.message}`);
          totalAdd += toAdd.length;
        }

        // 更新（已移除：车牌不变的记录不做字段更新）

        // 重排 seq_no（以 Excel 顺序为准）— 批量 upsert，一次请求完成
        const { data: allRows } = await supabase.from(table).select('id, plate_number').order('seq_no');
        if (allRows && allRows.length > 0) {
          const excelOrderMap = new Map(excelRows.map((r) => [r.plate_number, r.seq_no]));
          // 第一步：按 Excel 顺序赋值已存在于 Excel 的行
          const step1 = allRows
            .filter((row) => excelOrderMap.has(row.plate_number as string))
            .map((row) => ({ id: row.id, seq_no: excelOrderMap.get(row.plate_number as string)! }));
          if (step1.length > 0) {
            await supabase.from(table).upsert(step1, { onConflict: 'id' });
          }
          // 第二步：对全表按 seq_no 重新编号（1..N），一次 upsert 搞定
          const { data: reordered } = await supabase.from(table).select('id').order('seq_no');
          if (reordered && reordered.length > 0) {
            const renumber = reordered.map((r, i) => ({ id: r.id, seq_no: i + 1 }));
            await supabase.from(table).upsert(renumber, { onConflict: 'id' });
          }
        }
      }

      setResultMsg(`✅ 执行完成：新增 ${totalAdd} 辆，删除 ${totalDelete} 辆`);
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新失败，请重试');
    } finally {
      setApplying(false);
    }
  };

  const totalDiffs = allKeys.length;

  // ── 重置辅助 ──
  const resetAll = () => {
    setImportMode(null);
    setStep('pick');
    setFileName('');
    setError('');
    setSheetResults([]);
    setSheetDiffs(new Map());
    setDbRowsMap(new Map());
    setSelectedKeys(new Set());
    setResultMsg('');
    setOilDiffs([]);
    setOilSelectedCities(new Set());
    setOilTotalRows(0);
  };

  return (
    <LinearGradient colors={['#1a2744', '#0f172a']} style={{ flex: 1 }}>
      {/* ── Web 隐藏文件选择器（同步触发，避免浏览器手势拦截） ── */}
      {process.env.EXPO_OS === 'web' && (
        <>
          <input
            ref={vehicleInputRef}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              e.target.value = '';
              setFileName(file.name);
              setLoading(true);
              try {
                await processVehicleBuf(await file.arrayBuffer());
              } catch (err) {
                setError('解析失败：' + (err instanceof Error ? err.message : String(err)));
              } finally { setLoading(false); }
            }}
          />
          <input
            ref={oilInputRef}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              e.target.value = '';
              await processOilBuf(file.name, await file.arrayBuffer());
            }}
          />
        </>
      )}
      {/* 顶栏 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 56, paddingHorizontal: 16, paddingBottom: 16, gap: 12 }}>
        <Pressable
          onPress={() => importMode && step === 'pick' ? resetAll() : router.back()}
          style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}
        >
          <ArrowLeft size={20} color="#fff" />
        </Pressable>
        <Text style={{ color: '#fff', fontSize: 19, fontWeight: '700', flex: 1 }}>
          {importMode === 'oilprice' ? '导入全国油价' : importMode === 'vehicle' ? '导入车辆数据' : 'Excel 批量更新'}
        </Text>
        {importMode === 'oilprice'
          ? <Fuel size={22} color="#FBBF24" />
          : <FileSpreadsheet size={22} color="#34D399" />}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} showsVerticalScrollIndicator={false}>

        {/* ══════════════════════════════════════════════
            模式选择页（未选择导入类型时显示）
        ══════════════════════════════════════════════ */}
        {!importMode && (
          <>
            <Text style={{ color: '#64748B', fontSize: 13, textAlign: 'center' }}>请选择要导入的数据类型</Text>

            {/* 导入车辆数据 */}
            <Pressable
              onPress={() => setImportMode('vehicle')}
              style={{ backgroundColor: 'rgba(16,185,129,0.12)', borderRadius: 16, padding: 18, borderWidth: 1, borderColor: 'rgba(16,185,129,0.35)', flexDirection: 'row', alignItems: 'center', gap: 14 }}
            >
              <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(16,185,129,0.18)', alignItems: 'center', justifyContent: 'center' }}>
                <FileSpreadsheet size={22} color="#34D399" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#34D399', fontSize: 15, fontWeight: '700', marginBottom: 3 }}>导入车辆数据</Text>
                <Text style={{ color: '#64748B', fontSize: 12, lineHeight: 18 }}>{'汽油车 / 柴油车 / LNG车\n以车牌号为唯一键，比对新增 / 删除'}</Text>
              </View>
            </Pressable>

            {/* 导入油价信息 */}
            <Pressable
              onPress={() => setImportMode('oilprice')}
              style={{ backgroundColor: 'rgba(251,191,36,0.10)', borderRadius: 16, padding: 18, borderWidth: 1, borderColor: 'rgba(251,191,36,0.35)', flexDirection: 'row', alignItems: 'center', gap: 14 }}
            >
              <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(251,191,36,0.16)', alignItems: 'center', justifyContent: 'center' }}>
                <Fuel size={22} color="#FBBF24" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#FCD34D', fontSize: 15, fontWeight: '700', marginBottom: 3 }}>导入全国油价</Text>
                <Text style={{ color: '#64748B', fontSize: 12, lineHeight: 18 }}>{'31省市 92# / 95# / 98# / 0#柴油\n以城市名为唯一键，自动比对并更新价格'}</Text>
              </View>
            </Pressable>
          </>
        )}

        {/* ══════════════════════════════════════════════
            车辆导入流程
        ══════════════════════════════════════════════ */}
        {importMode === 'vehicle' && (
          <>
            {/* 步骤一：选文件 */}
            {step === 'pick' && (
              <>
                <View style={{ backgroundColor: 'rgba(59,130,246,0.12)', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: 'rgba(59,130,246,0.28)', gap: 8 }}>
                  <Text style={{ color: '#60A5FA', fontSize: 13, fontWeight: '700' }}>📋 支持的表格格式</Text>
                  <Text style={{ color: '#94A3B8', fontSize: 12, lineHeight: 20 }}>
                    与系统原始导出格式完全兼容：{'\n'}
                    • <Text style={{ color: '#CBD5E1' }}>Sheet 名含「汽油」→ 汽油车表</Text>{'\n'}
                    • <Text style={{ color: '#CBD5E1' }}>Sheet 名含「柴油」→ 柴油车表</Text>{'\n'}
                    • <Text style={{ color: '#CBD5E1' }}>Sheet 名含「LNG」→ LNG车表</Text>{'\n'}
                    第1行为标题，第2行为表头，第3行起为数据。以 <Text style={{ color: '#34D399' }}>车牌号</Text> 为唯一键比对新增/删除。
                  </Text>
                </View>
                {!!error && <ErrorBar msg={error} />}
                <Pressable
                  onPress={handlePickFile}
                  disabled={loading}
                  style={{ backgroundColor: '#10B981', borderRadius: 14, paddingVertical: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, opacity: loading ? 0.6 : 1 }}
                >
                  {loading ? <ActivityIndicator size="small" color="#fff" /> : <Upload size={20} color="#fff" />}
                  <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{loading ? '解析中...' : '选择 Excel 文件'}</Text>
                </Pressable>
                {!!fileName && <Text style={{ color: '#64748B', fontSize: 12, textAlign: 'center' }}>已选：{fileName}</Text>}
              </>
            )}

            {/* 步骤二：预览差异 */}
            {step === 'preview' && (
              <>
                <View style={{ backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
                  <Text style={{ color: '#F1F5F9', fontSize: 15, fontWeight: '700', marginBottom: 4 }}>比对结果</Text>
                  <Text style={{ color: '#64748B', fontSize: 12, marginBottom: 10 }}>文件：{fileName}</Text>
                  {sheetResults.map(({ type, rows, skipped }) => {
                    const diffs = sheetDiffs.get(type) ?? [];
                    return (
                      <View key={type} style={{ marginBottom: 8 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                          <Text style={{ color: '#94A3B8', fontSize: 12, fontWeight: '600' }}>{TYPE_LABEL[type]}（有效 {rows.length} 辆）</Text>
                          {skipped > 0 && (
                            <View style={{ backgroundColor: 'rgba(245,158,11,0.15)', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                              <AlertCircle size={10} color="#F59E0B" />
                              <Text style={{ color: '#F59E0B', fontSize: 10, fontWeight: '600' }}>已过滤 {skipped} 条油品不符</Text>
                            </View>
                          )}
                        </View>
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <SummaryBadge label="新增" count={diffs.filter((d) => d.type === 'add').length} color="#10B981" />
                          <SummaryBadge label="删除" count={diffs.filter((d) => d.type === 'delete').length} color="#EF4444" />
                          <SummaryBadge label="不变" count={rows.length - diffs.filter((d) => d.type === 'add').length} color="#475569" />
                        </View>
                      </View>
                    );
                  })}
                </View>

                {totalDiffs === 0 ? (
                  <View style={{ alignItems: 'center', gap: 10, paddingVertical: 24 }}>
                    <CheckCircle2 size={40} color="#10B981" />
                    <Text style={{ color: '#10B981', fontSize: 16, fontWeight: '700' }}>数据完全一致，无需更新</Text>
                  </View>
                ) : (
                  <>
                    <Pressable onPress={toggleAll} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 10, padding: 12 }}>
                      {isAllSelected ? <CheckSquare size={18} color="#3B82F6" /> : <Square size={18} color="#475569" />}
                      <Text style={{ color: '#94A3B8', fontSize: 13, fontWeight: '600', flex: 1 }}>{isAllSelected ? '取消全选' : '全选所有变更'}</Text>
                      <Text style={{ color: '#3B82F6', fontSize: 12, fontWeight: '700' }}>已选 {selectedCount} / {totalDiffs}</Text>
                    </Pressable>

                    {sheetResults.map(({ type }) => {
                      const diffs = sheetDiffs.get(type) ?? [];
                      if (diffs.length === 0) return null;
                      const typeKeys = diffs.map((d) => diffKey(type, d.plate_number));
                      const allTypeSelected = typeKeys.every((k) => selectedKeys.has(k));
                      const someTypeSelected = typeKeys.some((k) => selectedKeys.has(k));
                      return (
                        <View key={type}>
                          <Pressable onPress={() => toggleTypeAll(type, diffs)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6, marginTop: 4 }}>
                            {allTypeSelected ? <CheckSquare size={15} color="#3B82F6" /> : someTypeSelected ? <CheckSquare size={15} color="#64748B" /> : <Square size={15} color="#475569" />}
                            <Text style={{ color: '#94A3B8', fontSize: 12, fontWeight: '700', flex: 1 }}>{TYPE_LABEL[type]} 变更明细（{diffs.length} 项）</Text>
                            <Text style={{ color: '#475569', fontSize: 11 }}>点击全选/取消</Text>
                          </Pressable>
                          {diffs.map((d) => {
                            const key = diffKey(type, d.plate_number);
                            const checked = selectedKeys.has(key);
                            return (
                              <Pressable key={key} onPress={() => toggleKey(key)}
                                style={{ backgroundColor: checked ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 13, marginBottom: 7, flexDirection: 'row', alignItems: 'center', gap: 10, borderLeftWidth: 3, borderLeftColor: checked ? (d.type === 'add' ? '#10B981' : '#EF4444') : '#334155', borderWidth: 1, borderColor: checked ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)' }}
                              >
                                {checked ? <CheckSquare size={18} color="#3B82F6" /> : <Square size={18} color="#334155" />}
                                {d.type === 'add' ? <Plus size={14} color={checked ? '#10B981' : '#475569'} /> : <Trash2 size={14} color={checked ? '#EF4444' : '#475569'} />}
                                <View style={{ flex: 1 }}>
                                  <Text style={{ color: checked ? '#F1F5F9' : '#64748B', fontSize: 14, fontWeight: '600' }}>{d.plate_number}</Text>
                                  <Text style={{ color: '#475569', fontSize: 12, marginTop: 2 }}>{d.type === 'add' ? '新增' : '将从数据库删除'}{d.excelRow?.unit ? `  · ${d.excelRow.unit}` : ''}</Text>
                                </View>
                                <Text style={{ color: checked ? (d.type === 'add' ? '#10B981' : '#EF4444') : '#334155', fontSize: 11, fontWeight: '700' }}>{d.type === 'add' ? '新增' : '删除'}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      );
                    })}

                    {!!error && <ErrorBar msg={error} />}
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                      <Pressable onPress={() => { setStep('pick'); setSheetDiffs(new Map()); setFileName(''); setError(''); setSelectedKeys(new Set()); }} style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, paddingVertical: 15, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                        <RefreshCw size={15} color="#94A3B8" />
                        <Text style={{ color: '#94A3B8', fontWeight: '600', fontSize: 14 }}>重新选择</Text>
                      </Pressable>
                      <Pressable onPress={handleApply} disabled={applying || selectedCount === 0} style={{ flex: 2, backgroundColor: selectedCount > 0 ? '#3B82F6' : '#1e3a5f', borderRadius: 12, paddingVertical: 15, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6, opacity: applying ? 0.7 : 1 }}>
                        {applying ? <ActivityIndicator size="small" color="#fff" /> : <CheckCircle2 size={15} color="#fff" />}
                        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>{applying ? '执行中...' : `执行选中项（${selectedCount} 项）`}</Text>
                      </Pressable>
                    </View>
                  </>
                )}
              </>
            )}

            {/* 步骤三：完成 */}
            {step === 'done' && <DoneView msg={resultMsg} onBack={() => router.replace('/(app)/home' as never)} onAgain={resetAll} />}
          </>
        )}

        {/* ══════════════════════════════════════════════
            油价导入流程
        ══════════════════════════════════════════════ */}
        {importMode === 'oilprice' && (
          <>
            {/* 步骤一：选文件 */}
            {step === 'pick' && (
              <>
                <View style={{ backgroundColor: 'rgba(251,191,36,0.10)', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: 'rgba(251,191,36,0.28)', gap: 8 }}>
                  <Text style={{ color: '#FCD34D', fontSize: 13, fontWeight: '700' }}>⛽ 油价表格式说明</Text>
                  <Text style={{ color: '#94A3B8', fontSize: 12, lineHeight: 20 }}>
                    表头（第一行）必须包含以下列：{'\n'}
                    • <Text style={{ color: '#CBD5E1' }}>地区</Text>　
                    • <Text style={{ color: '#CBD5E1' }}>92#汽油</Text>　
                    • <Text style={{ color: '#CBD5E1' }}>95#汽油</Text>　
                    • <Text style={{ color: '#CBD5E1' }}>98#汽油</Text>　
                    • <Text style={{ color: '#CBD5E1' }}>0#柴油</Text>{'\n'}
                    以 <Text style={{ color: '#FBBF24' }}>地区</Text> 为唯一键，与数据库比对后 <Text style={{ color: '#34D399' }}>upsert</Text>。
                  </Text>
                </View>
                {!!error && <ErrorBar msg={error} />}
                <Pressable
                  onPress={handlePickOilFile}
                  disabled={loading}
                  style={{ backgroundColor: '#D97706', borderRadius: 14, paddingVertical: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, opacity: loading ? 0.6 : 1 }}
                >
                  {loading ? <ActivityIndicator size="small" color="#fff" /> : <Upload size={20} color="#fff" />}
                  <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{loading ? '解析中...' : '选择油价 Excel 文件'}</Text>
                </Pressable>
                {!!fileName && <Text style={{ color: '#64748B', fontSize: 12, textAlign: 'center' }}>已选：{fileName}</Text>}
              </>
            )}

            {/* 步骤二：预览油价差异 */}
            {step === 'preview' && (
              <>
                {/* 汇总卡 */}
                <View style={{ backgroundColor: 'rgba(251,191,36,0.08)', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(251,191,36,0.25)', gap: 10 }}>
                  <Text style={{ color: '#FCD34D', fontSize: 15, fontWeight: '700' }}>油价比对结果</Text>
                  <Text style={{ color: '#64748B', fontSize: 12 }}>文件：{fileName}</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <SummaryBadge label="新增城市" count={oilDiffs.filter((d) => d.diffType === 'add').length} color="#10B981" />
                    <SummaryBadge label="价格变动" count={oilDiffs.filter((d) => d.diffType === 'update').length} color="#FBBF24" />
                    <SummaryBadge label="无变化" count={oilDiffs.filter((d) => d.diffType === 'same').length} color="#475569" />
                  </View>
                  <Text style={{ color: '#475569', fontSize: 11 }}>共读取 {oilTotalRows} 个城市 · 仅显示有差异的条目</Text>
                </View>

                {oilChangedCities.length === 0 ? (
                  <View style={{ alignItems: 'center', gap: 10, paddingVertical: 24 }}>
                    <CheckCircle2 size={40} color="#10B981" />
                    <Text style={{ color: '#10B981', fontSize: 16, fontWeight: '700' }}>油价数据完全一致，无需更新</Text>
                  </View>
                ) : (
                  <>
                    {/* 全选栏 */}
                    <Pressable onPress={toggleOilAll} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 10, padding: 12 }}>
                      {isOilAllSelected ? <CheckSquare size={18} color="#FBBF24" /> : <Square size={18} color="#475569" />}
                      <Text style={{ color: '#94A3B8', fontSize: 13, fontWeight: '600', flex: 1 }}>{isOilAllSelected ? '取消全选' : '全选所有变更'}</Text>
                      <Text style={{ color: '#FBBF24', fontSize: 12, fontWeight: '700' }}>已选 {oilSelectedCities.size} / {oilChangedCities.length}</Text>
                    </Pressable>

                    {/* 差异列表 */}
                    {oilDiffs.filter((d) => d.diffType !== 'same').map((d) => {
                      const checked = oilSelectedCities.has(d.city);
                      const isAdd = d.diffType === 'add';
                      const accentColor = isAdd ? '#10B981' : '#FBBF24';
                      return (
                        <Pressable key={d.city} onPress={() => toggleOilCity(d.city)}
                          style={{ backgroundColor: checked ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 13, marginBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 10, borderLeftWidth: 3, borderLeftColor: checked ? accentColor : '#334155', borderWidth: 1, borderColor: checked ? `${accentColor}30` : 'rgba(255,255,255,0.04)' }}
                        >
                          {checked ? <CheckSquare size={18} color="#FBBF24" /> : <Square size={18} color="#334155" />}
                          {isAdd ? <Plus size={14} color={checked ? '#10B981' : '#475569'} /> : <Edit3 size={14} color={checked ? '#FBBF24' : '#475569'} />}
                          <View style={{ flex: 1, gap: 3 }}>
                            <Text style={{ color: checked ? '#F1F5F9' : '#64748B', fontSize: 14, fontWeight: '700' }}>{d.city}</Text>
                            {isAdd ? (
                              <Text style={{ color: '#475569', fontSize: 11 }}>
                                92:{d.excelRow.p92}  95:{d.excelRow.p95}  98:{d.excelRow.p98}  柴:{d.excelRow.p0}
                              </Text>
                            ) : (
                              <View style={{ gap: 2 }}>
                                {(d.changedFields ?? []).map((f) => {
                                  const keyMap: Record<string, keyof OilPriceExcelRow> = { '92#': 'p92', '95#': 'p95', '98#': 'p98', '0#柴': 'p0' };
                                  const dbKeyMap: Record<string, keyof OilPriceDbRow> = { '92#': 'p92', '95#': 'p95', '98#': 'p98', '0#柴': 'p0' };
                                  const exVal = d.excelRow[keyMap[f]];
                                  const dbVal = d.dbRow?.[dbKeyMap[f]] ?? '—';
                                  return (
                                    <Text key={f} style={{ fontSize: 11 }}>
                                      <Text style={{ color: '#64748B' }}>{f}：</Text>
                                      <Text style={{ color: '#94A3B8' }}>{dbVal}</Text>
                                      <Text style={{ color: '#475569' }}> → </Text>
                                      <Text style={{ color: '#34D399', fontWeight: '700' }}>{exVal}</Text>
                                    </Text>
                                  );
                                })}
                              </View>
                            )}
                          </View>
                          <View style={{ backgroundColor: `${accentColor}20`, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: `${accentColor}40` }}>
                            <Text style={{ color: accentColor, fontSize: 10, fontWeight: '700' }}>{isAdd ? '新增' : '更新'}</Text>
                          </View>
                        </Pressable>
                      );
                    })}

                    {!!error && <ErrorBar msg={error} />}
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                      <Pressable onPress={() => { setStep('pick'); setOilDiffs([]); setFileName(''); setError(''); setOilSelectedCities(new Set()); }} style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, paddingVertical: 15, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                        <RefreshCw size={15} color="#94A3B8" />
                        <Text style={{ color: '#94A3B8', fontWeight: '600', fontSize: 14 }}>重新选择</Text>
                      </Pressable>
                      <Pressable onPress={handleApplyOil} disabled={applying || oilSelectedCities.size === 0} style={{ flex: 2, backgroundColor: oilSelectedCities.size > 0 ? '#D97706' : '#3a2800', borderRadius: 12, paddingVertical: 15, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6, opacity: applying ? 0.7 : 1 }}>
                        {applying ? <ActivityIndicator size="small" color="#fff" /> : <CheckCircle2 size={15} color="#fff" />}
                        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>{applying ? '写入中...' : `更新 ${oilSelectedCities.size} 个城市`}</Text>
                      </Pressable>
                    </View>
                  </>
                )}
              </>
            )}

            {/* 步骤三：完成 */}
            {step === 'done' && <DoneView msg={resultMsg} onBack={() => router.replace('/(app)/home' as never)} onAgain={resetAll} />}
          </>
        )}

      </ScrollView>
    </LinearGradient>
  );
}

// ── 错误条 ──────────────────────────────────────────────────────────
function ErrorBar({ msg }: { msg: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 10, padding: 12 }}>
      <AlertCircle size={16} color="#EF4444" />
      <Text style={{ color: '#EF4444', fontSize: 13, flex: 1 }}>{msg}</Text>
    </View>
  );
}

// ── 完成页 ──────────────────────────────────────────────────────────
function DoneView({ msg, onBack, onAgain }: { msg: string; onBack: () => void; onAgain: () => void }) {
  return (
    <View style={{ alignItems: 'center', gap: 20, paddingVertical: 32 }}>
      <CheckCircle2 size={56} color="#10B981" />
      <Text style={{ color: '#10B981', fontSize: 18, fontWeight: '700', textAlign: 'center' }}>{msg}</Text>
      <Pressable onPress={onBack} style={{ backgroundColor: '#3B82F6', borderRadius: 14, paddingHorizontal: 36, paddingVertical: 16 }}>
        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>返回首页</Text>
      </Pressable>
      <Pressable onPress={onAgain}>
        <Text style={{ color: '#64748B', fontSize: 13 }}>继续导入另一份表格</Text>
      </Pressable>
    </View>
  );
}
// ── 汇总徽章 ──────────────────────────────────────────────────────────
function SummaryBadge({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 8, paddingVertical: 8, alignItems: 'center', borderWidth: 1, borderColor: `${color}40` }}>
      <Text style={{ color, fontSize: 18, fontWeight: '800' }}>{count}</Text>
      <Text style={{ color: '#64748B', fontSize: 11, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

// ── 构建数据库写入 payload ────────────────────────────────────────────
function buildPayload(row: ExcelRow, type: VehicleType): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    seq_no: row.seq_no,
    unit: row.unit || null,
    plate_number: row.plate_number,
    vehicle_model: row.vehicle_model || null,
    body_color: row.body_color || null,
    fuel_type: row.fuel_type || defaultFuelType(type),
    oil_card: row.oil_card || null,
    driver_name: row.driver_name || null,
  };
  if (type === 'gasoline') payload.gas_grade = row.gas_grade || null;
  if (type === 'lng') payload.remark = row.remark || null;
  return payload;
}
