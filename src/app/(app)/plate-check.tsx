/**
 * 加油记录查错页 v4
 * 核心逻辑变更：
 *   - 不再依赖正则提取车牌，直接把 OCR 每行文字里的字母数字片段
 *     拿去数据库 ILIKE 比对（末尾4~5位），命中即返回真实车牌信息
 *   - 这样即使省份汉字识别错/缺失，只要数字字母识别对就能命中
 */
import { useState, useRef } from 'react';
import {
  View, Text, Pressable, ActivityIndicator, ScrollView, TextInput, KeyboardAvoidingView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { fetch } from 'expo/fetch';
import { supabase } from '@/client/supabase';
import {
  ArrowLeft, Camera, CheckCircle2, AlertTriangle, XCircle,
  RefreshCw, ClipboardList, Car, ShieldAlert, ScanLine,
  Plus, Trash2, PenLine, Building2,
} from 'lucide-react-native';

// ── 类型 ─────────────────────────────────────────────────────────────
interface MatchResult {
  plate: string;          // 数据库实际车牌号（ILIKE 命中后取 DB 真实值）
  ocrRaw: string;         // OCR 识别原文（展示用）
  found: boolean;
  unit?: string;
  model?: string;
  fuelType?: string;
  isAnomaly: boolean;
  anomalyType: 'wrong_unit' | 'unknown' | 'normal';
  source: 'ocr' | 'manual';
}

type DBRow = { plate_number: string; unit: string; vehicle_model: string };

/**
 * 从 OCR 文字里提取所有 4~6 位字母数字片段（去除纯数字/纯字母噪声）
 * 这些片段对应车牌的"字母+数字"部分，用于 ILIKE 模糊匹配
 */
/**
 * 从 OCR 文字里提取两类片段（v8 全面增强）：
 *
 * 1. 字母数字混合片段（3~8位，含至少1字母+1数字）
 *    - 长度放宽：3~8（原4~6），捕获更多手写简写
 *    - 混淆字符变体：O↔0、I↔1、S↔5、B↔8、Z↔2、G↔6（手写OCR高频误读）
 *
 * 2. 纯数字片段（3~6位）—— 省份/字母识别错时的兜底
 *
 * segments:      所有变体（含混淆互换），用于 ILIKE 查询
 * originals:     原始识别到的混合片段（展示用，不含变体）
 * digitSegments: 原始识别到的纯数字片段（展示用）
 */
function extractAlnumSegments(words: string[]): {
  segments: string[];
  digitSegments: string[];
  originals: string[];
} {
  const mixedSet = new Set<string>();
  const digitSet = new Set<string>();
  const origSet  = new Set<string>();

  // 放宽至 3~8 位，捕获手写简写和残缺车牌
  const MIXED_RE = /(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*[0-9])[A-Z0-9]{3,8}/g;
  // 纯数字放宽至 3~6 位
  const DIGIT_RE = /\d{3,6}/g;

  /** 生成所有混淆字符替换变体（手写高频误读对） */
  function genVariants(s: string): string[] {
    const CONFUSE: [RegExp, string][] = [
      [/O/g, '0'], [/0/g, 'O'],
      [/I/g, '1'], [/1/g, 'I'],
      [/S/g, '5'], [/5/g, 'S'],
      [/B/g, '8'], [/8/g, 'B'],
      [/Z/g, '2'], [/2/g, 'Z'],
      [/G/g, '6'], [/6/g, 'G'],
    ];
    const result = new Set<string>();
    // 单字符替换变体
    for (const [re, ch] of CONFUSE) {
      const v = s.replace(re, ch);
      if (v !== s) result.add(v);
    }
    // 二阶变体（O→0 后再 I→1 等常见叠加组合）
    const base = Array.from(result);
    for (const b of base) {
      for (const [re, ch] of CONFUSE) {
        const v = b.replace(re, ch);
        if (v !== b && v !== s) result.add(v);
      }
    }
    return Array.from(result);
  }

  for (const w of words) {
    // 去空格、全角转半角、转大写
    const clean = w
      .replace(/\s+/g, '')
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .toUpperCase();

    // ── 混合片段 ──
    const mixedMatches = clean.match(MIXED_RE);
    if (mixedMatches) {
      mixedMatches.forEach((m) => {
        origSet.add(m);
        mixedSet.add(m);
        genVariants(m).forEach((v) => mixedSet.add(v));
      });
    }

    // ── 纯数字片段 ──
    const digitMatches = clean.match(DIGIT_RE);
    if (digitMatches) {
      digitMatches.forEach((d) => digitSet.add(d));
    }
  }

  return {
    segments:      Array.from(mixedSet),
    digitSegments: Array.from(digitSet),
    originals:     Array.from(origSet),
  };
}

/**
 * 核心查询（v8 增强）：
 * 1. 混合片段：limit 提升到 8，覆盖更多同号段变体
 * 2. 数字片段：命中 > DIGIT_MAX_HITS 丢弃（防误报）
 * 两路合并，plate_number 严格去重
 */
const DIGIT_MAX_HITS = 2;

async function queryBySegments(
  segments: string[],
  digitSegments: string[],
  source: 'ocr' | 'manual',
): Promise<MatchResult[]> {
  const validMixed  = segments.filter((s) => s.length >= 3);
  const validDigits = digitSegments.filter((d) => d.length >= 3);
  if (validMixed.length === 0 && validDigits.length === 0) return [];

  // ── 混合片段查询（limit 提升到 8） ──
  const mixedRows = (await Promise.all(
    validMixed.map(async (seg) => {
      const [g, d, l] = await Promise.all([
        supabase.from('gasoline_vehicles').select('plate_number, unit, vehicle_model')
          .ilike('plate_number', `%${seg}%`).limit(8),
        supabase.from('diesel_vehicles').select('plate_number, unit, vehicle_model')
          .ilike('plate_number', `%${seg}%`).limit(8),
        supabase.from('lng_vehicles').select('plate_number, unit, vehicle_model')
          .ilike('plate_number', `%${seg}%`).limit(8),
      ]);
      return [
        ...(g.data || []).map((r: DBRow) => ({ ...r, ft: '汽油' })),
        ...(d.data || []).map((r: DBRow) => ({ ...r, ft: '柴油' })),
        ...(l.data || []).map((r: DBRow) => ({ ...r, ft: 'LNG' })),
      ] as Array<DBRow & { ft: string }>;
    }),
  )).flat();

  // ── 纯数字片段查询（命中 > DIGIT_MAX_HITS 丢弃） ──
  const digitRows = (await Promise.all(
    validDigits.map(async (seg) => {
      const [g, d, l] = await Promise.all([
        supabase.from('gasoline_vehicles').select('plate_number, unit, vehicle_model')
          .ilike('plate_number', `%${seg}%`).limit(DIGIT_MAX_HITS + 1),
        supabase.from('diesel_vehicles').select('plate_number, unit, vehicle_model')
          .ilike('plate_number', `%${seg}%`).limit(DIGIT_MAX_HITS + 1),
        supabase.from('lng_vehicles').select('plate_number, unit, vehicle_model')
          .ilike('plate_number', `%${seg}%`).limit(DIGIT_MAX_HITS + 1),
      ]);
      const rows = [
        ...(g.data || []).map((r: DBRow) => ({ ...r, ft: '汽油' })),
        ...(d.data || []).map((r: DBRow) => ({ ...r, ft: '柴油' })),
        ...(l.data || []).map((r: DBRow) => ({ ...r, ft: 'LNG' })),
      ] as Array<DBRow & { ft: string }>;
      if (rows.length > DIGIT_MAX_HITS) return [];
      return rows;
    }),
  )).flat();

  const allRows = [...mixedRows, ...digitRows];
  const plateMap = new Map<string, MatchResult>();
  for (const row of allRows) {
    const key = row.plate_number.toUpperCase();
    if (!plateMap.has(key)) {
      plateMap.set(key, {
        plate: key, ocrRaw: key, found: true,
        unit: row.unit, model: row.vehicle_model, fuelType: row.ft,
        isAnomaly: false, anomalyType: 'normal', source,
      });
    }
  }
  return Array.from(plateMap.values());
}

/**
 * 手动输入查询（v8 增强）：
 * 1. 精确匹配
 * 2. 末尾 5 位 ILIKE
 * 3. 末尾 4 位 ILIKE（兜底，应对末位手写缺失）
 * 4. 中间段（去首去尾各1位）ILIKE
 */
async function queryManual(raw: string): Promise<MatchResult[]> {
  const upper = raw.toUpperCase().replace(/\s+/g, '');

  const searchOne = async (seg: string): Promise<Array<DBRow & { ft: string }>> => {
    const [g, d, l] = await Promise.all([
      supabase.from('gasoline_vehicles').select('plate_number, unit, vehicle_model').ilike('plate_number', `%${seg}%`).limit(2),
      supabase.from('diesel_vehicles').select('plate_number, unit, vehicle_model').ilike('plate_number', `%${seg}%`).limit(2),
      supabase.from('lng_vehicles').select('plate_number, unit, vehicle_model').ilike('plate_number', `%${seg}%`).limit(2),
    ]);
    return [
      ...(g.data || []).map((r: DBRow) => ({ ...r, ft: '汽油' })),
      ...(d.data || []).map((r: DBRow) => ({ ...r, ft: '柴油' })),
      ...(l.data || []).map((r: DBRow) => ({ ...r, ft: 'LNG' })),
    ];
  };

  // 精确查
  const [ge, de, le] = await Promise.all([
    supabase.from('gasoline_vehicles').select('plate_number, unit, vehicle_model').eq('plate_number', upper).limit(1),
    supabase.from('diesel_vehicles').select('plate_number, unit, vehicle_model').eq('plate_number', upper).limit(1),
    supabase.from('lng_vehicles').select('plate_number, unit, vehicle_model').eq('plate_number', upper).limit(1),
  ]);
  const exactRows: Array<DBRow & { ft: string }> = [
    ...(ge.data || []).map((r: DBRow) => ({ ...r, ft: '汽油' })),
    ...(de.data || []).map((r: DBRow) => ({ ...r, ft: '柴油' })),
    ...(le.data || []).map((r: DBRow) => ({ ...r, ft: 'LNG' })),
  ];
  if (exactRows.length > 0) {
    const row = exactRows[0];
    return [{ plate: row.plate_number.toUpperCase(), ocrRaw: upper, found: true, unit: row.unit, model: row.vehicle_model, fuelType: row.ft, isAnomaly: false, anomalyType: 'normal', source: 'manual' }];
  }

  // 多段兜底：末5位、末4位、中间段并发，取第一个命中
  const segs = [
    upper.length >= 5 ? upper.slice(-5) : null,
    upper.length >= 4 ? upper.slice(-4) : null,
    upper.length >= 6 ? upper.slice(1, -1) : null,
  ].filter((s): s is string => !!s && s.length >= 3);

  const fuzzyResults = await Promise.all(segs.map(searchOne));
  for (const rows of fuzzyResults) {
    if (rows.length > 0) {
      const row = rows[0];
      return [{ plate: row.plate_number.toUpperCase(), ocrRaw: upper, found: true, unit: row.unit, model: row.vehicle_model, fuelType: row.ft, isAnomaly: false, anomalyType: 'normal', source: 'manual' }];
    }
  }
  return [{ plate: upper, ocrRaw: upper, found: false, isAnomaly: true, anomalyType: 'unknown', source: 'manual' }];
}

// ── 分公司列表（与数据库 unit 字段一致）────────────────────────────
const UNITS = ['公务用车管理分中心', '生产用车管理分中心', '通勤用车管理分中心'];

// 单位颜色映射
const UNIT_COLORS: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  '公务用车管理分中心': { bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.4)', text: '#60A5FA', icon: '#3B82F6' },
  '生产用车管理分中心': { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.4)', text: '#FCD34D', icon: '#F59E0B' },
  '通勤用车管理分中心': { bg: 'rgba(52,211,153,0.1)',  border: 'rgba(52,211,153,0.35)', text: '#34D399', icon: '#10B981' },
};
const DEFAULT_UNIT_COLOR = { bg: 'rgba(148,163,184,0.1)', border: 'rgba(148,163,184,0.3)', text: '#94A3B8', icon: '#64748B' };

// ── 组件 ──────────────────────────────────────────────────────────────
export default function PlateCheckPage() {
  const router = useRouter();

  // step: idle（选分公司） → shooting → ocring → querying → done
  const [step, setStep] = useState<'idle' | 'shooting' | 'ocring' | 'querying' | 'done'>('idle');
  // 用户选定的分公司（必选才能开始扫描）
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [errorMsg, setErrorMsg]   = useState('');
  const [results, setResults]     = useState<MatchResult[]>([]);
  const [ocrRawWords, setOcrRawWords] = useState<string[]>([]);
  const [ocrSegments, setOcrSegments] = useState<string[]>([]); // 提取到的字母数字片段（展示用）
  const [ocrDigits, setOcrDigits]     = useState<string[]>([]); // 提取到的纯数字片段（展示用）
  const [ocrExpanded, setOcrExpanded] = useState(false);        // OCR 原始行是否展开
  const [manualInput, setManualInput] = useState('');
  const [manualList, setManualList]   = useState<string[]>([]);
  const sessionRef = useRef(0);

  // ── 核心：按「选定分公司」判定异常（区分外来车辆/其他分公司/正常）──
  const buildFinal = (raw: MatchResult[], chosen: string): MatchResult[] =>
    raw.map((r) => {
      if (!r.found) return { ...r, isAnomaly: true, anomalyType: 'unknown' as const };     // 数据库无记录 → 外来车辆
      if (r.unit !== chosen) return { ...r, isAnomaly: true, anomalyType: 'wrong_unit' as const }; // 有记录但属于其他分公司
      return { ...r, isAnomaly: false, anomalyType: 'normal' as const };
    }).sort((a, b) => (a.isAnomaly === b.isAnomaly ? 0 : a.isAnomaly ? -1 : 1));

  // ── 拍照 + OCR + 比对 ────────────────────────────────────────────
  const handleScan = async () => {
    if (!selectedUnit) return;
    const sid = ++sessionRef.current;
    setErrorMsg('');
    setResults([]);
    setOcrRawWords([]);
    setOcrSegments([]);
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      setErrorMsg('请授权相机权限以使用拍照识别功能');
      setStep('idle');
      return;
    }

    const picked = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 1.0,
      exif: false,
    });
    if (picked.canceled || !picked.assets?.[0]) { setStep('idle'); return; }

    setStep('ocring');
    const compressed = await ImageManipulator.manipulateAsync(
      picked.assets[0].uri,
      [{ resize: { width: 1920 } }],  // 提升分辨率上限，保留更多手写细节
      { compress: 0.95, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );
    if (!compressed.base64) {
      setErrorMsg('图片压缩失败，请重新拍照');
      setStep('idle');
      return;
    }

    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
    const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
    let rawWords: string[] = [];
    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/accurate-ocr`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${supabaseKey}`,
          apikey: supabaseKey,
        },
        body: JSON.stringify({
          image: compressed.base64,
          language_type: 'CHN_ENG',
          detect_direction: true,
          multidirectional_recognize: true,
          probability: true,  // 返回每行置信度，用于过滤低质量行
        }),
      });
      if (!resp.ok) throw new Error('OCR 请求失败');
      const ocrData = await resp.json();
      // 置信度过滤：丢弃平均置信度 < 0.6 的行（纯噪声），保留高质量文字行
      // 无 probability 字段时保留（兜底）
      type OcrWord = { words: string; probability?: { average: number } };
      const allWords: OcrWord[] = ocrData.words_result || [];
      rawWords = allWords
        .filter((w) => !w.probability || w.probability.average >= 0.6)
        .map((w) => w.words);
      setOcrRawWords(rawWords);

      const { segments, digitSegments, originals } = extractAlnumSegments(rawWords);
      setOcrSegments(originals);
      setOcrDigits(digitSegments);
      if (segments.length === 0 && digitSegments.length === 0) {
        setErrorMsg('未识别到车牌字符，可在下方手动补录');
        setStep('done');
        return;
      }
      setStep('querying');
      const ocrResults = await queryBySegments(segments, digitSegments, 'ocr');
      if (sid !== sessionRef.current) return;

      let merged = ocrResults;
      if (manualList.length > 0) {
        const manualResults = await Promise.all(manualList.map((p) => queryManual(p)));
        manualResults.flat().forEach((r) => {
          if (!merged.some((x) => x.plate === r.plate)) merged = [...merged, r];
        });
      }

      setResults(buildFinal(merged, selectedUnit));
      setStep('done');
    } catch {
      setErrorMsg('识别或查询失败，请确认图片清晰后重试');
      setStep('idle');
    }
  };

  // ── 手动补录 ──────────────────────────────────────────────────────
  const handleAddManual = async () => {
    if (!selectedUnit) return;
    const raw = manualInput.trim().toUpperCase().replace(/\s/g, '');
    if (!raw || manualList.includes(raw)) { setManualInput(''); return; }
    setManualList((prev) => [...prev, raw]);
    setManualInput('');
    try {
      const newRes = await queryManual(raw);
      setResults((prev) => {
        const merged = [...prev, ...newRes.filter((r) => !prev.some((x) => x.plate === r.plate))];
        return buildFinal(merged, selectedUnit);
      });
    } catch { /* 静默 */ }
  };

  // ── 删除一条结果 ──────────────────────────────────────────────────
  const handleRemoveResult = (plate: string) => {
    if (!selectedUnit) return;
    const newResults = results.filter((r) => r.plate !== plate);
    setManualList((prev) => prev.filter((p) => p !== plate));
    setResults(buildFinal(newResults, selectedUnit));
  };

  const reset = () => {
    // 保留 selectedUnit，方便同批次多次扫描无需重选分公司
    setStep('idle');
    setErrorMsg('');
    setResults([]);
    setOcrRawWords([]);
    setOcrSegments([]);
    setOcrDigits([]);
    setOcrExpanded(false);
    setManualInput('');
    setManualList([]);
  };

  const normalCount    = results.filter((r) => !r.isAnomaly).length;
  const wrongUnitCount = results.filter((r) => r.isAnomaly && r.anomalyType === 'wrong_unit').length;
  const outsiderCount  = results.filter((r) => r.isAnomaly && r.anomalyType === 'unknown').length;
  const anomalyCount   = wrongUnitCount + outsiderCount;
  const unitColor      = selectedUnit ? (UNIT_COLORS[selectedUnit] ?? DEFAULT_UNIT_COLOR) : DEFAULT_UNIT_COLOR;

  // 各分公司车辆数统计（含已找到的所有 found 车辆）
  const unitBreakdown: { unit: string; count: number }[] = (() => {
    const freq = new Map<string, number>();
    for (const r of results) {
      if (r.found && r.unit) freq.set(r.unit, (freq.get(r.unit) ?? 0) + 1);
    }
    return Array.from(freq.entries())
      .map(([unit, count]) => ({ unit, count }))
      .sort((a, b) => b.count - a.count);
  })();

  // ── 车牌仿真组件 ──────────────────────────────────────────────────
  const PlateTag = ({ plate, color }: { plate: string; color: string }) => (
    <View style={{ flexDirection: 'row', borderRadius: 3, overflow: 'hidden', borderWidth: 1, borderColor: color }}>
      <View style={{ backgroundColor: '#0052CC', paddingHorizontal: 6, paddingVertical: 3 }}>
        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>
          {plate.length > 1 ? plate.slice(0, 1) : '?'}
        </Text>
      </View>
      <View style={{ backgroundColor: '#1E293B', paddingHorizontal: 8, paddingVertical: 3 }}>
        <Text style={{ color, fontWeight: '800', fontSize: 13, letterSpacing: 2 }}>
          {plate.length > 1 ? plate.slice(1) : plate}
        </Text>
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#0A0F1E' }}
      behavior={process.env.EXPO_OS === 'ios' ? 'padding' : 'height'}
    >
      {/* ── Header ── */}
      <LinearGradient
        colors={['#0D2A4B', '#0E4D3A', '#0A6E4A']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ paddingTop: 56, paddingBottom: 20, paddingHorizontal: 20 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable onPress={() => router.back()} hitSlop={12}
            style={{ width: 36, height: 36, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
            <ArrowLeft size={18} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800' }}>加油记录查错</Text>
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 2 }}>
              {selectedUnit
                ? `当前分公司：${selectedUnit}`
                : '请先选择分公司，再拍照识别'}
            </Text>
          </View>
          <ClipboardList size={22} color="#34D399" />
        </View>
      </LinearGradient>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, gap: 14 }}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Step 1：选择分公司（始终显示，done后可更换） ── */}
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Building2 size={15} color="#34D399" />
            <Text style={{ color: '#34D399', fontSize: 13, fontWeight: '700' }}>
              第一步：选择本次加油的分公司
            </Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {UNITS.map((u) => {
              const uc = UNIT_COLORS[u] ?? DEFAULT_UNIT_COLOR;
              const isSelected = selectedUnit === u;
              return (
                <Pressable
                  key={u}
                  onPress={() => {
                    setSelectedUnit(u);
                    // 如果已有结果，切换分公司后重新分类
                    if (results.length > 0) setResults(buildFinal(results, u));
                  }}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 6,
                    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
                    backgroundColor: isSelected ? uc.bg : 'rgba(30,41,59,0.8)',
                    borderWidth: isSelected ? 1.5 : 1,
                    borderColor: isSelected ? uc.border : 'rgba(71,85,105,0.4)',
                  }}
                  android_ripple={{ color: 'rgba(255,255,255,0.1)', borderless: false }}
                >
                  {isSelected && (
                    <CheckCircle2 size={13} color={uc.icon} />
                  )}
                  <Text style={{
                    color: isSelected ? uc.text : '#64748B',
                    fontSize: 13, fontWeight: isSelected ? '700' : '500',
                  }}>{u}</Text>
                </Pressable>
              );
            })}
          </View>
          {!selectedUnit && (
            <Text style={{ color: '#475569', fontSize: 12, marginTop: 2 }}>
              ⬆️ 选择分公司后才能开始拍照识别
            </Text>
          )}
        </View>

        {/* ── 拍照提示（选了分公司才显示，idle且无结果） ── */}
        {selectedUnit && step === 'idle' && results.length === 0 && (
          <View style={{ backgroundColor: 'rgba(52,211,153,0.07)', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: 'rgba(52,211,153,0.18)', gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ShieldAlert size={15} color="#34D399" />
              <Text style={{ color: '#34D399', fontSize: 13, fontWeight: '700' }}>拍照技巧</Text>
            </View>
            <Text style={{ color: '#64748B', fontSize: 12, lineHeight: 20 }}>
              📌 对准车牌号那一列拍，避免整页拍{'\n'}
              ✂️ 拍后可裁剪聚焦到车牌区域{'\n'}
              ✍️ 识别不全时可在下方手动补录
            </Text>
          </View>
        )}

        {/* ── 加载状态 ── */}
        {(step === 'shooting' || step === 'ocring' || step === 'querying') && (
          <View style={{ alignItems: 'center', paddingVertical: 56, gap: 18 }}>
            <ActivityIndicator size="large" color="#34D399" />
            <Text style={{ color: '#94A3B8', fontSize: 15, fontWeight: '600' }}>
              {step === 'shooting' ? '请拍摄加油记录...'
                : step === 'ocring' ? '正在识别车牌（多方向扫描中）...'
                : '正在比对数据库...'}
            </Text>
            {selectedUnit && (
              <View style={{ backgroundColor: unitColor.bg, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: unitColor.border }}>
                <Text style={{ color: unitColor.text, fontSize: 12, fontWeight: '700' }}>
                  比对目标：{selectedUnit}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* ── 错误提示 ── */}
        {!!errorMsg && (
          <View style={{ backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)', flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <XCircle size={16} color="#EF4444" style={{ marginTop: 1 }} />
            <Text style={{ color: '#FCA5A5', fontSize: 13, flex: 1, lineHeight: 20 }}>{errorMsg}</Text>
          </View>
        )}

        {/* ── OCR 原始识别内容 + 提取片段 ── */}
        {step === 'done' && ocrRawWords.length > 0 && (
          <View style={{ backgroundColor: 'rgba(148,163,184,0.05)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(148,163,184,0.1)', overflow: 'hidden' }}>
            {/* 提取到的车牌片段（始终显示） */}
            <View style={{ padding: 14, gap: 8 }}>
              {/* 字母数字混合片段（绿色） */}
              <View style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <ScanLine size={13} color="#34D399" />
                  <Text style={{ color: '#34D399', fontSize: 12, fontWeight: '700' }}>
                    字母数字片段（{ocrSegments.length} 个）
                  </Text>
                </View>
                {ocrSegments.length > 0 ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {ocrSegments.map((seg) => (
                      <View key={seg} style={{ backgroundColor: 'rgba(52,211,153,0.1)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(52,211,153,0.25)' }}>
                        <Text style={{ color: '#6EE7B7', fontSize: 12, fontWeight: '700', letterSpacing: 1 }}>{seg}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={{ color: '#475569', fontSize: 11 }}>无</Text>
                )}
              </View>
              {/* 纯数字片段（黄色）—— 省份/字母识别错时的兜底匹配依据 */}
              <View style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Car size={13} color="#FBBF24" />
                  <Text style={{ color: '#FBBF24', fontSize: 12, fontWeight: '700' }}>
                    纯数字片段（{ocrDigits.length} 个，兜底匹配）
                  </Text>
                </View>
                {ocrDigits.length > 0 ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {ocrDigits.map((d) => (
                      <View key={d} style={{ backgroundColor: 'rgba(251,191,36,0.1)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(251,191,36,0.3)' }}>
                        <Text style={{ color: '#FCD34D', fontSize: 12, fontWeight: '700', letterSpacing: 1 }}>{d}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={{ color: '#475569', fontSize: 11 }}>无</Text>
                )}
              </View>
            </View>

            {/* 折叠/展开 触发行 */}
            <Pressable
              onPress={() => setOcrExpanded((v) => !v)}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderTopColor: 'rgba(148,163,184,0.1)', backgroundColor: 'rgba(148,163,184,0.04)' }}
            >
              <Text style={{ color: '#475569', fontSize: 11, fontWeight: '600' }}>
                OCR 原始识别内容（{ocrRawWords.length} 行，绿色为提取片段）
              </Text>
              <Text style={{ color: '#475569', fontSize: 11 }}>{ocrExpanded ? '▲ 收起' : '▼ 展开'}</Text>
            </Pressable>

            {/* 原始行内容（折叠时隐藏） */}
            {ocrExpanded && (
              <View style={{ paddingHorizontal: 14, paddingBottom: 14, paddingTop: 8, gap: 4 }}>
                {ocrRawWords.map((line, i) => {
                  if (ocrSegments.length === 0) {
                    return (
                      <Text key={i} style={{ color: '#475569', fontSize: 11, lineHeight: 18 }}>{line}</Text>
                    );
                  }
                  const escaped = ocrSegments.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
                  const re = new RegExp(`(${escaped.join('|')})`, 'gi');
                  const parts = line.split(re);
                  return (
                    <Text key={i} style={{ fontSize: 11, lineHeight: 20 }}>
                      {parts.map((part, j) => {
                        const isHit = ocrSegments.some((s) => s.toUpperCase() === part.toUpperCase());
                        return isHit ? (
                          <Text key={j} style={{ color: '#34D399', fontWeight: '800', backgroundColor: 'rgba(52,211,153,0.15)', letterSpacing: 1 }}>{part}</Text>
                        ) : (
                          <Text key={j} style={{ color: '#475569' }}>{part}</Text>
                        );
                      })}
                    </Text>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* ── 手动补录（done 后显示）── */}
        {step === 'done' && (
          <View style={{ backgroundColor: 'rgba(167,139,250,0.08)', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: 'rgba(167,139,250,0.25)', gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <PenLine size={15} color="#A78BFA" />
              <Text style={{ color: '#A78BFA', fontSize: 13, fontWeight: '700' }}>手动补录车牌</Text>
              <Text style={{ color: '#475569', fontSize: 11 }}>（OCR 未识别时使用）</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                value={manualInput}
                onChangeText={(t) => setManualInput(t.toUpperCase().replace(/\s/g, ''))}
                placeholder="如：冀A12345"
                placeholderTextColor="#334155"
                autoCapitalize="characters"
                maxLength={8}
                returnKeyType="done"
                onSubmitEditing={handleAddManual}
                style={{ flex: 1, backgroundColor: '#1E293B', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, color: '#F1F5F9', fontSize: 15, fontWeight: '700', letterSpacing: 2, borderWidth: 1, borderColor: 'rgba(167,139,250,0.3)' }}
              />
              <Pressable
                onPress={handleAddManual}
                style={{ width: 44, height: 44, backgroundColor: '#7C3AED', borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}
                android_ripple={{ color: 'rgba(255,255,255,0.2)', borderless: false }}
              >
                <Plus size={20} color="#fff" />
              </Pressable>
            </View>
          </View>
        )}

        {/* ── 结果区 ── */}
        {step === 'done' && results.length > 0 && selectedUnit && (
          <>
            {/* 选定分公司 banner */}
            <LinearGradient
              colors={['#0C3D2E', '#064E3B', '#065F46']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{ borderRadius: 14, padding: 16, borderWidth: 1, borderColor: unitColor.border, flexDirection: 'row', alignItems: 'center', gap: 12 }}
            >
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: unitColor.bg, alignItems: 'center', justifyContent: 'center' }}>
                <Building2 size={22} color={unitColor.icon} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#6EE7B7', fontSize: 11, fontWeight: '600', marginBottom: 2 }}>
                  本次比对基准分公司
                </Text>
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>{selectedUnit}</Text>
              </View>
              {/* 更换分公司按钮：先清扫描结果，再重选分公司 */}
              <Pressable
                onPress={() => { reset(); setSelectedUnit(null); }}
                style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}
              >
                <Text style={{ color: '#94A3B8', fontSize: 11 }}>更换</Text>
              </Pressable>
            </LinearGradient>

            {/* 漏斗统计：始终显示，拍照模式三段，纯手动模式两段 */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(15,23,42,0.6)', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1, borderColor: 'rgba(148,163,184,0.12)', gap: 4, flexWrap: 'wrap' }}>
              {ocrRawWords.length > 0 ? (
                <>
                  <Text style={{ color: '#64748B', fontSize: 12, fontWeight: '700' }}>识别</Text>
                  <Text style={{ color: '#F1F5F9', fontSize: 13, fontWeight: '800' }}>{ocrRawWords.length}</Text>
                  <Text style={{ color: '#64748B', fontSize: 12 }}>行</Text>
                  <Text style={{ color: '#334155', fontSize: 13, marginHorizontal: 4 }}>→</Text>
                  <Text style={{ color: '#64748B', fontSize: 12, fontWeight: '700' }}>提取</Text>
                  <Text style={{ color: '#6EE7B7', fontSize: 13, fontWeight: '800' }}>{ocrSegments.length}</Text>
                  <Text style={{ color: '#64748B', fontSize: 12 }}>片段</Text>
                  <Text style={{ color: '#334155', fontSize: 13, marginHorizontal: 4 }}>→</Text>
                </>
              ) : (
                <>
                  <Text style={{ color: '#64748B', fontSize: 12, fontWeight: '700' }}>手动录入</Text>
                  <Text style={{ color: '#A78BFA', fontSize: 13, fontWeight: '800' }}>{manualList.length}</Text>
                  <Text style={{ color: '#64748B', fontSize: 12 }}>条</Text>
                  <Text style={{ color: '#334155', fontSize: 13, marginHorizontal: 4 }}>→</Text>
                </>
              )}
              <Text style={{ color: '#64748B', fontSize: 12, fontWeight: '700' }}>命中</Text>
              <Text style={{ color: '#34D399', fontSize: 13, fontWeight: '800' }}>{results.length}</Text>
              <Text style={{ color: '#64748B', fontSize: 12 }}>辆</Text>
            </View>

            {/* 汇总统计：两格 */}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1, backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)', alignItems: 'center', gap: 3 }}>
                <Text style={{ color: '#F87171', fontSize: 20, fontWeight: '800' }}>{wrongUnitCount}</Text>
                <Text style={{ color: '#94A3B8', fontSize: 11, textAlign: 'center' }}>⚠️ 其他分公司</Text>
              </View>
              <View style={{ flex: 1, backgroundColor: 'rgba(239,68,68,0.08)', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)', alignItems: 'center', gap: 3 }}>
                <Text style={{ color: '#F87171', fontSize: 20, fontWeight: '800' }}>{outsiderCount}</Text>
                <Text style={{ color: '#94A3B8', fontSize: 11, textAlign: 'center' }}>🚗 外来车辆</Text>
              </View>
              <View style={{ flex: 1, backgroundColor: 'rgba(52,211,153,0.08)', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: 'rgba(52,211,153,0.2)', alignItems: 'center', gap: 3 }}>
                <Text style={{ color: '#34D399', fontSize: 20, fontWeight: '800' }}>{normalCount}</Text>
                <Text style={{ color: '#94A3B8', fontSize: 11, textAlign: 'center' }}>✅ 本分公司</Text>
              </View>
            </View>

            {/* 各分公司车辆分布 */}
            {unitBreakdown.length > 0 && (
              <View style={{ backgroundColor: 'rgba(15,23,42,0.5)', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: 'rgba(148,163,184,0.1)', gap: 8 }}>
                <Text style={{ color: '#64748B', fontSize: 11, fontWeight: '700' }}>📊 各分公司车辆分布</Text>
                {unitBreakdown.map(({ unit, count }) => {
                  const uc = UNIT_COLORS[unit] ?? DEFAULT_UNIT_COLOR;
                  const isSelected = unit === selectedUnit;
                  const pct = results.length > 0 ? Math.round((count / results.length) * 100) : 0;
                  return (
                    <View key={unit} style={{ gap: 4 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          {isSelected && <CheckCircle2 size={11} color={uc.icon} />}
                          <Text style={{ color: isSelected ? uc.text : '#94A3B8', fontSize: 12, fontWeight: isSelected ? '700' : '400' }}>
                            {unit}
                          </Text>
                        </View>
                        <Text style={{ color: uc.text, fontSize: 12, fontWeight: '800' }}>
                          {count} 辆 <Text style={{ color: '#475569', fontWeight: '400' }}>({pct}%)</Text>
                        </Text>
                      </View>
                      {/* 进度条 */}
                      <View style={{ height: 4, backgroundColor: 'rgba(148,163,184,0.1)', borderRadius: 2, overflow: 'hidden' }}>
                        <View style={{ height: 4, width: `${pct}%`, backgroundColor: isSelected ? uc.icon : '#334155', borderRadius: 2 }} />
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            {/* 异常车辆 */}
            {anomalyCount > 0 && (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <AlertTriangle size={15} color="#F97316" />
                  <Text style={{ color: '#F97316', fontSize: 13, fontWeight: '700' }}>异常车辆（需核查）</Text>
                  <View style={{ backgroundColor: 'rgba(249,115,22,0.2)', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 }}>
                    <Text style={{ color: '#F97316', fontSize: 11, fontWeight: '700' }}>{anomalyCount} 辆</Text>
                  </View>
                </View>
                {results.filter((r) => r.isAnomaly).map((item) => {
                  const isOutsider = item.anomalyType === 'unknown';
                  const otherUc = item.unit ? (UNIT_COLORS[item.unit] ?? DEFAULT_UNIT_COLOR) : DEFAULT_UNIT_COLOR;
                  const cardBg = isOutsider ? 'rgba(239,68,68,0.07)' : 'rgba(249,115,22,0.07)';
                  const cardBorder = isOutsider ? 'rgba(239,68,68,0.5)' : 'rgba(249,115,22,0.5)';
                  const iconColor = isOutsider ? '#F87171' : '#F97316';
                  return (
                    <View key={item.plate} style={{
                      backgroundColor: cardBg,
                      borderRadius: 14, padding: 14,
                      borderWidth: 1.5, borderColor: cardBorder,
                    }}>
                      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                        <View style={{
                          width: 44, height: 44, borderRadius: 22,
                          backgroundColor: isOutsider ? 'rgba(239,68,68,0.15)' : 'rgba(249,115,22,0.15)',
                          alignItems: 'center', justifyContent: 'center',
                        }}>
                          {isOutsider
                            ? <XCircle size={20} color={iconColor} />
                            : <Building2 size={20} color={iconColor} />
                          }
                        </View>
                        <View style={{ flex: 1, gap: 6 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <PlateTag plate={item.plate} color={isOutsider ? '#F87171' : '#FB923C'} />
                            {isOutsider ? (
                              <View style={{ backgroundColor: 'rgba(239,68,68,0.2)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
                                <Text style={{ color: '#F87171', fontSize: 10, fontWeight: '700' }}>🚗 外来车辆</Text>
                              </View>
                            ) : (
                              <View style={{ backgroundColor: 'rgba(249,115,22,0.2)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
                                <Text style={{ color: '#FB923C', fontSize: 10, fontWeight: '700' }}>⚠️ 其他分公司</Text>
                              </View>
                            )}
                            {item.source === 'manual' && (
                              <View style={{ backgroundColor: 'rgba(167,139,250,0.2)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                                <Text style={{ color: '#A78BFA', fontSize: 10 }}>手动</Text>
                              </View>
                            )}
                          </View>
                          <View style={{
                            backgroundColor: isOutsider ? 'rgba(239,68,68,0.08)' : otherUc.bg,
                            borderRadius: 8, padding: 10,
                            borderWidth: 1,
                            borderColor: isOutsider ? 'rgba(239,68,68,0.3)' : otherUc.border,
                            gap: 3,
                          }}>
                            {isOutsider ? (
                              <>
                                <Text style={{ color: '#F87171', fontSize: 12, fontWeight: '700' }}>
                                  未在数据库中登记
                                </Text>
                                <Text style={{ color: '#64748B', fontSize: 11, marginTop: 2 }}>
                                  该车牌不属于任何分公司，可能为外来车辆
                                </Text>
                              </>
                            ) : (
                              <>
                                <Text style={{ color: otherUc.text, fontSize: 12, fontWeight: '700' }}>
                                  属于：{item.unit ?? '未知单位'}
                                </Text>
                                {item.model && (
                                  <Text style={{ color: '#94A3B8', fontSize: 11 }}>
                                    车型：{item.model} · {item.fuelType}
                                  </Text>
                                )}
                                <Text style={{ color: '#64748B', fontSize: 11, marginTop: 2 }}>
                                  与本次选定「{selectedUnit}」不符，请核查
                                </Text>
                              </>
                            )}
                          </View>
                        </View>
                        <Pressable onPress={() => handleRemoveResult(item.plate)} hitSlop={8}>
                          <Trash2 size={16} color="#475569" />
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </>
            )}

            {/* 本分公司车辆 */}
            {normalCount > 0 && (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <CheckCircle2 size={15} color="#34D399" />
                  <Text style={{ color: '#34D399', fontSize: 13, fontWeight: '700' }}>
                    本分公司车辆（正常）
                  </Text>
                  <View style={{ backgroundColor: 'rgba(52,211,153,0.15)', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 }}>
                    <Text style={{ color: '#34D399', fontSize: 11, fontWeight: '700' }}>{normalCount} 辆</Text>
                  </View>
                </View>
                {results.filter((r) => !r.isAnomaly).map((item) => (
                  <View key={item.plate} style={{
                    backgroundColor: '#1E293B', borderRadius: 14,
                    padding: 14, borderWidth: 1, borderColor: 'rgba(52,211,153,0.18)',
                    flexDirection: 'row', alignItems: 'center', gap: 12,
                  }}>
                    <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(52,211,153,0.1)', alignItems: 'center', justifyContent: 'center' }}>
                      <Car size={20} color="#34D399" />
                    </View>
                    <View style={{ flex: 1, gap: 3 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <PlateTag plate={item.plate} color="#F1F5F9" />
                        {item.fuelType && (
                          <View style={{ backgroundColor: 'rgba(52,211,153,0.15)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
                            <Text style={{ color: '#34D399', fontSize: 10, fontWeight: '700' }}>{item.fuelType}</Text>
                          </View>
                        )}
                        {item.source === 'manual' && (
                          <View style={{ backgroundColor: 'rgba(167,139,250,0.2)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                            <Text style={{ color: '#A78BFA', fontSize: 10 }}>手动</Text>
                          </View>
                        )}
                      </View>
                      {item.unit && (
                        <Text style={{ color: '#94A3B8', fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                          {item.unit}
                        </Text>
                      )}
                      {item.model && (
                        <Text style={{ color: '#64748B', fontSize: 11 }} numberOfLines={1}>
                          {item.model}
                        </Text>
                      )}
                    </View>
                    <Pressable onPress={() => handleRemoveResult(item.plate)} hitSlop={8}>
                      <Trash2 size={16} color="#475569" />
                    </Pressable>
                  </View>
                ))}
              </>
            )}
          </>
        )}

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* ── 底部按钮 ── */}
      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        paddingHorizontal: 16, paddingBottom: 34, paddingTop: 12,
        backgroundColor: 'rgba(10,15,30,0.96)',
        borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)',
        gap: 10,
      }}>
        {step === 'done' ? (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              onPress={reset}
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(148,163,184,0.15)', borderRadius: 12, paddingVertical: 14, borderWidth: 1, borderColor: 'rgba(148,163,184,0.25)' }}
              android_ripple={{ color: 'rgba(255,255,255,0.1)', borderless: false }}
            >
              <RefreshCw size={16} color="#94A3B8" />
              <Text style={{ color: '#94A3B8', fontSize: 14, fontWeight: '600' }}>清空重来</Text>
            </Pressable>
            <Pressable
              onPress={handleScan}
              disabled={!selectedUnit}
              style={{ flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: selectedUnit ? '#059669' : 'rgba(5,150,105,0.4)', borderRadius: 12, paddingVertical: 14 }}
              android_ripple={{ color: 'rgba(255,255,255,0.2)', borderless: false }}
            >
              <Camera size={18} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>再次扫描</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={handleScan}
            disabled={!selectedUnit || step !== 'idle'}
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
              backgroundColor: (selectedUnit && step === 'idle') ? '#059669' : 'rgba(5,150,105,0.35)',
              borderRadius: 14, paddingVertical: 16,
              opacity: (!selectedUnit || step !== 'idle') ? 0.55 : 1,
            }}
            android_ripple={{ color: 'rgba(255,255,255,0.2)', borderless: false }}
          >
            <Camera size={20} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>
              {selectedUnit ? '📷 拍照识别车牌' : '请先选择分公司 ↑'}
            </Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
