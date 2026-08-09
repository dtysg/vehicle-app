import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  FlatList,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { ArrowLeft, Search, Check, X, ChevronRight, Edit3, Camera, ShieldOff } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { fetch } from 'expo/fetch';
import { supabase } from '@/client/supabase';

// ── 内联琴键按钮 ──────────────────────────────────────────────
function GasKeyItem({ label, color, active, onPress }: {
  label: string; color: string; active: boolean; onPress: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable onPress={onPress} onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)} style={{ flex: 1 }}>
      <View style={{
        height: 40, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, overflow: 'hidden',
        transform: [{ translateY: pressed ? 2 : 0 }],
        backgroundColor: active ? color : (pressed ? `${color}30` : `${color}15`),
        justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 8,
        borderWidth: 1, borderColor: active ? `${color}99` : `${color}40`,
      }}>
        {!pressed && <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 6, backgroundColor: `${color}40` }} />}
        <Text style={{ color: active ? '#fff' : color, fontSize: 12, fontWeight: '700', zIndex: 1 }}>{label}</Text>
      </View>
    </Pressable>
  );
}

type VehicleType = 'gasoline' | 'diesel' | 'lng';

interface Vehicle {
  id: number;
  seq_no: number;
  unit: string;
  plate_number: string;
  vehicle_model: string;
  body_color: string;
  fuel_type: string;
  gas_grade?: string;
  oil_card: string;
  driver_name?: string;
  remark?: string;
  _type: VehicleType;
}

const TABLE_MAP: Record<VehicleType, string> = {
  gasoline: 'gasoline_vehicles',
  diesel: 'diesel_vehicles',
  lng: 'lng_vehicles',
};

const TYPE_LABELS: Record<VehicleType, string> = {
  gasoline: '汽油车辆',
  diesel: '柴油车辆',
  lng: 'LNG车辆',
};

const TYPE_BG: Record<VehicleType, string> = {
  gasoline: '#FF5630',
  diesel: '#16A34A',
  lng: '#0EA5E9',
};

// 车牌正则
const PLATE_REGEX = /[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤川青藏琼宁][A-Z][A-Z0-9]{5}/;

async function imageToBase64(uri: string): Promise<string> {
  const r = await fetch(uri);
  const buf = await r.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

async function ocrPlate(uri: string): Promise<string> {
  const b64 = await imageToBase64(uri);
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const resp = await fetch(`${url}/functions/v1/accurate-ocr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, apikey: key },
    body: JSON.stringify({ image: b64, language_type: 'CHN_ENG' }),
  });
  if (!resp.ok) throw new Error('OCR 失败');
  const data = await resp.json();
  const words: string[] = (data.words_result ?? []).map((w: { words: string }) => w.words);
  for (const w of words) {
    const m = w.replace(/\s/g, '').toUpperCase().match(PLATE_REGEX);
    if (m) return m[0];
  }
  return words.sort((a, b) => b.length - a.length)[0] ?? '';
}

// ── 单行 FormField（带可选语音/拍照）

function Field({
  label, value, onChangeText, placeholder, autoCapitalize,
  onCamera, cameraLoading, readOnly,
}: {
  label: string; value: string; onChangeText?: (v: string) => void;
  placeholder?: string; autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  onCamera?: () => void; cameraLoading?: boolean; readOnly?: boolean;
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ color: '#475569', fontSize: 12, marginBottom: 4 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder ?? `请输入${label}`}
          placeholderTextColor="#94A3B8"
          autoCapitalize={autoCapitalize}
          editable={!readOnly}
          style={{
            flex: 1, borderWidth: 1, borderColor: readOnly ? '#F1F5F9' : '#E2E8F0',
            borderRadius: 2, backgroundColor: readOnly ? '#F8FAFC' : '#fff',
            paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: readOnly ? '#94A3B8' : '#1A2332',
          }}
        />
        {onCamera && (
          <Pressable onPress={onCamera} disabled={cameraLoading}
            style={{ width: 38, height: 38, borderRadius: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F0FDF4', borderWidth: 1, borderColor: '#86EFAC' }}>
            {cameraLoading ? <ActivityIndicator size="small" color="#16A34A" /> : <Camera size={16} color="#16A34A" />}
          </Pressable>
        )}
      </View>
    </View>
  );
}

type Stage = 'search' | 'edit';

export default function VehicleEditPage() {
  const router = useRouter();
  const isAdmin = true; // 无需登录，所有用户均有管理权限

  // ── 搜索阶段
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState('');
  const [results, setResults] = useState<Vehicle[]>([]);
  const [searched, setSearched] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);

  // ── 编辑阶段
  const [stage, setStage] = useState<Stage>('search');
  const [editVehicle, setEditVehicle] = useState<Vehicle | null>(null);
  const [form, setForm] = useState<Partial<Vehicle>>({});
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const [done, setDone] = useState(false);

  const [camLoading, setCamLoading] = useState(false);

  // ── 搜索
  const handleSearch = async (q?: string) => {
    const kw = (q ?? query).trim();
    if (!kw) { setSearchErr('请输入车牌号'); return; }
    setSearching(true); setSearchErr(''); setSearched(true); setResults([]);
    try {
      const [gasRes, dieselRes, lngRes] = await Promise.all([
        supabase.from('gasoline_vehicles').select('*').ilike('plate_number', `%${kw}%`),
        supabase.from('diesel_vehicles').select('*').ilike('plate_number', `%${kw}%`),
        supabase.from('lng_vehicles').select('*').ilike('plate_number', `%${kw}%`),
      ]);
      const all: Vehicle[] = [
        ...(gasRes.data ?? []).map((v) => ({ ...v, _type: 'gasoline' as VehicleType })),
        ...(dieselRes.data ?? []).map((v) => ({ ...v, _type: 'diesel' as VehicleType })),
        ...(lngRes.data ?? []).map((v) => ({ ...v, _type: 'lng' as VehicleType })),
      ];
      setResults(all);
      if (all.length === 0) setSearchErr('未找到匹配的车辆');
    } catch { setSearchErr('网络异常，请稍后重试'); }
    finally { setSearching(false); }
  };

  // 拍照 OCR（搜索框）
  const handleSearchCamera = async () => {
    setOcrLoading(true); setSearchErr('');
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') { setSearchErr('请授权相机权限'); return; }
      const result = await ImagePicker.launchCameraAsync({ allowsEditing: false, quality: 0.85 });
      if (result.canceled || !result.assets?.[0]) return;
      const compressed = await ImageManipulator.manipulateAsync(result.assets[0].uri, [{ resize: { width: 1080 } }], { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      const plate = await ocrPlate(compressed.uri);
      if (plate) { setQuery(plate); handleSearch(plate); }
      else setSearchErr('未识别到车牌，请手动输入');
    } catch { setSearchErr('拍照识别失败'); }
    finally { setOcrLoading(false); }
  };

  // 拍照 OCR（编辑车牌号）
  const handleEditCamera = async () => {
    setCamLoading(true);
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') { setSaveErr('请授权相机权限'); return; }
      const result = await ImagePicker.launchCameraAsync({ allowsEditing: false, quality: 0.85 });
      if (result.canceled || !result.assets?.[0]) return;
      const compressed = await ImageManipulator.manipulateAsync(result.assets[0].uri, [{ resize: { width: 1080 } }], { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      const plate = await ocrPlate(compressed.uri);
      if (plate) setForm((p) => ({ ...p, plate_number: plate }));
      else setSaveErr('未识别到车牌，请手动输入');
    } catch { setSaveErr('拍照识别失败'); }
    finally { setCamLoading(false); }
  };

  // 选择车辆进入编辑
  const selectVehicle = (v: Vehicle) => {
    setEditVehicle(v);
    setForm({
      seq_no: v.seq_no,
      unit: v.unit ?? '',
      plate_number: v.plate_number ?? '',
      vehicle_model: v.vehicle_model ?? '',
      body_color: v.body_color ?? '',
      gas_grade: v.gas_grade ?? '',
      oil_card: v.oil_card ?? '',
      driver_name: v.driver_name ?? '',
      remark: v.remark ?? '',
    });
    setSaveErr(''); setDone(false);
    setStage('edit');
  };

  const setF = (key: string) => (v: string) => setForm((p) => ({ ...p, [key]: v }));

  // 保存
  const handleSave = async () => {
    if (!editVehicle) return;
    if (!String(form.plate_number ?? '').trim()) { setSaveErr('车牌号码不能为空'); return; }
    setSaving(true); setSaveErr('');
    const payload: Record<string, unknown> = {
      unit: String(form.unit ?? '').trim() || null,
      plate_number: String(form.plate_number ?? '').trim(),
      vehicle_model: String(form.vehicle_model ?? '').trim() || null,
      body_color: String(form.body_color ?? '').trim() || null,
      oil_card: String(form.oil_card ?? '').trim() || null,
      driver_name: String(form.driver_name ?? '').trim() || null,
    };
    if (editVehicle._type === 'gasoline') payload.gas_grade = String(form.gas_grade ?? '').trim() || null;
    if (editVehicle._type === 'lng') payload.remark = String(form.remark ?? '').trim() || null;

    const { error } = await supabase.from(TABLE_MAP[editVehicle._type]).update(payload).eq('id', editVehicle.id);
    setSaving(false);
    if (error) setSaveErr('保存失败，请稍后重试');
    else setDone(true);
  };

  const handleReset = () => {
    setStage('search'); setEditVehicle(null); setForm({});
    setDone(false); setSaveErr(''); setResults([]); setSearched(false); setQuery(''); setSearchErr('');
  };

  return (
    <KeyboardAvoidingView behavior={process.env.EXPO_OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: '#F5F7FA' }}>
      {/* Header */}
      <LinearGradient
        colors={['#2D1B69', '#5B21B6', '#8B5CF6']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ paddingTop: 56, paddingBottom: 16, paddingHorizontal: 16 }}
      >
        <Pressable onPress={() => stage === 'edit' ? setStage('search') : router.back()}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          <ArrowLeft size={20} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 15 }}>{stage === 'edit' ? '返回结果' : '返回'}</Text>
        </Pressable>
        <Text style={{ color: '#fff', fontSize: 20, fontWeight: 'bold' }}>信息修改</Text>
        <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12, marginTop: 4 }}>
          {stage === 'search' ? '输入车牌号搜索，选择车辆后修改信息' : `正在编辑：${editVehicle?.plate_number}`}
        </Text>
      </LinearGradient>

      {/* ── 搜索阶段 */}
      {stage === 'search' && (
        <View style={{ flex: 1 }}>
          {/* 搜索框 */}
          <View style={{ backgroundColor: '#F0F4FF', borderBottomWidth: 1, borderBottomColor: '#C7D7F5', padding: 14, gap: 10 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: '#C7D7F5', borderRadius: 8, backgroundColor: '#fff', height: 46, paddingHorizontal: 12, gap: 8 }}>
                <Search size={16} color="#6B8BC3" />
                <TextInput
                  style={{ flex: 1, color: '#1A2332', fontSize: 15 }}
                  placeholder="输入车牌号（支持模糊）"
                  placeholderTextColor="#93ACCC"
                  value={query}
                  onChangeText={(v) => { setQuery(v); setSearchErr(''); }}
                  autoCapitalize="characters"
                  returnKeyType="search"
                  onSubmitEditing={() => handleSearch()}
                />
                {query.length > 0 && (
                  <Pressable onPress={() => { setQuery(''); setSearchErr(''); setResults([]); setSearched(false); }} hitSlop={8}>
                    <X size={15} color="#93ACCC" />
                  </Pressable>
                )}
              </View>
              <Pressable onPress={handleSearchCamera} disabled={ocrLoading}
                style={{ width: 46, height: 46, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F0FDF4', borderWidth: 1, borderColor: '#86EFAC' }}>
                {ocrLoading ? <ActivityIndicator size="small" color="#16A34A" /> : <Camera size={18} color="#16A34A" />}
              </Pressable>
              <Pressable onPress={() => handleSearch()} disabled={searching}
                style={{ width: 64, height: 46, borderRadius: 8, backgroundColor: '#8B5CF6', alignItems: 'center', justifyContent: 'center' }}
                android_ripple={{ color: 'rgba(255,255,255,0.25)', borderless: false }}>
                {searching ? <ActivityIndicator size="small" color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '600', fontSize: 14 }}>查询</Text>}
              </Pressable>
            </View>
            {searchErr ? <Text style={{ color: '#DC2626', fontSize: 13 }}>{searchErr}</Text> : null}
          </View>

          {/* 结果列表 */}
          <FlatList
            data={results}
            keyExtractor={(item) => `${item._type}-${item.id}`}
            contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
            contentInsetAdjustmentBehavior="automatic"
            style={{ backgroundColor: '#F5F7FA' }}
            ListHeaderComponent={
              searched && !searching && results.length > 0 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 6 }}>
                  <View style={{ width: 3, height: 14, backgroundColor: '#8B5CF6', borderRadius: 2 }} />
                  <Text style={{ color: '#475569', fontSize: 13 }}>共找到 {results.length} 辆，点击选择要修改的车辆</Text>
                </View>
              ) : null
            }
            ListEmptyComponent={
              !searching && !searched ? (
                <View style={{ alignItems: 'center', paddingTop: 60, gap: 10 }}>
                  <View style={{ width: 72, height: 72, backgroundColor: '#F3E8FF', borderRadius: 36, alignItems: 'center', justifyContent: 'center' }}>
                    <Edit3 size={32} color="#C4B5FD" />
                  </View>
                  <Text style={{ color: '#64748B', fontSize: 15, fontWeight: '500' }}>搜索车辆后选择修改</Text>
                  <Text style={{ color: '#94A3B8', fontSize: 13 }}>支持部分车牌模糊查询</Text>
                </View>
              ) : null
            }
            renderItem={({ item }) => (
              <Pressable onPress={() => selectVehicle(item)}
                style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2EAF4', borderRadius: 10, marginBottom: 10 }}
                android_ripple={{ color: 'rgba(139,92,246,0.08)', borderless: false }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14, gap: 12 }}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ color: '#0F172A', fontWeight: '700', fontSize: 16 }}>{item.plate_number}</Text>
                      <View style={{ backgroundColor: TYPE_BG[item._type], borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600' }}>{TYPE_LABELS[item._type]}</Text>
                      </View>
                    </View>
                    <Text style={{ color: '#475569', fontSize: 13 }}>{item.unit || '（未填写单位）'}</Text>
                    <Text style={{ color: '#94A3B8', fontSize: 12 }}>{item.vehicle_model} · {item.body_color}</Text>
                  </View>
                  <ChevronRight size={18} color="#CBD5E1" />
                </View>
              </Pressable>
            )}
          />
        </View>
      )}

      {/* ── 编辑阶段 */}
      {stage === 'edit' && editVehicle && !done && (
        <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
          style={{ backgroundColor: '#F5F7FA' }}>
          {/* 车辆标识（只读） */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <View style={{ backgroundColor: TYPE_BG[editVehicle._type], borderRadius: 4, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>{TYPE_LABELS[editVehicle._type]}</Text>
            </View>
            <Text style={{ color: '#94A3B8', fontSize: 13 }}>序号 {editVehicle.seq_no}</Text>
          </View>

          <View style={{ backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#E2EAF4', padding: 14 }}>
            <Field label="车牌号码 *" value={String(form.plate_number ?? '')} onChangeText={setF('plate_number')}
              autoCapitalize="characters"
              onCamera={handleEditCamera} cameraLoading={camLoading} />
            <Field label="所属单位" value={String(form.unit ?? '')} onChangeText={setF('unit')} />
            <Field label="车型" value={String(form.vehicle_model ?? '')} onChangeText={setF('vehicle_model')} />
            <Field label="车身颜色" value={String(form.body_color ?? '')} onChangeText={setF('body_color')} />
            {/* 所用油品：只读，根据类别自动显示 */}
            <View style={{ marginBottom: 12 }}>
              <Text style={{ color: '#475569', fontSize: 12, marginBottom: 4 }}>所用油品</Text>
              <View style={{ borderWidth: 1, borderColor: '#F1F5F9', borderRadius: 2, backgroundColor: '#F8FAFC', paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ backgroundColor: TYPE_BG[editVehicle._type], borderRadius: 2, paddingHorizontal: 7, paddingVertical: 2 }}>
                  <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>{TYPE_LABELS[editVehicle._type]}</Text>
                </View>
                <Text style={{ color: '#94A3B8', fontSize: 13 }}>{TYPE_LABELS[editVehicle._type]}（自动）</Text>
              </View>
            </View>
            {editVehicle._type === 'gasoline' && (
              <View style={{ marginBottom: 12 }}>
                <Text style={{ color: '#475569', fontSize: 12, marginBottom: 6 }}>汽油标号</Text>
                {/* 琴键式标号选择 */}
                <View style={{ flexDirection: 'row', gap: 1.5, borderRadius: 10, overflow: 'hidden', backgroundColor: '#0A0F1E', borderWidth: 1.5, borderColor: '#E2E8F0' }}>
                  {([{ label: '92号汽油', color: '#F97316' }, { label: '95号汽油', color: '#EF4444' }, { label: '98号汽油', color: '#1A2332' }] as { label: string; color: string }[]).map(({ label, color }) => {
                    const active = form.gas_grade === label;
                    return (
                      <GasKeyItem key={label} label={label} color={color} active={active}
                        onPress={() => setForm((p) => ({ ...p, gas_grade: label }))} />
                    );
                  })}
                </View>
              </View>
            )}
            <Field label="所用油卡" value={String(form.oil_card ?? '')} onChangeText={setF('oil_card')} />
            <Field label="司机姓名" value={String(form.driver_name ?? '')} onChangeText={setF('driver_name')} />
          </View>

          {saveErr ? <Text style={{ color: '#DC2626', fontSize: 13, marginTop: 10 }}>{saveErr}</Text> : null}

          {isAdmin ? (
            <Pressable onPress={handleSave} disabled={saving}
              style={{ marginTop: 18, height: 48, borderRadius: 10, backgroundColor: '#8B5CF6', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              android_ripple={{ color: 'rgba(255,255,255,0.25)', borderless: false }}>
              {saving ? <ActivityIndicator size="small" color="#fff" />
                : <><Check size={18} color="#fff" /><Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>保存修改</Text></>}
            </Pressable>
          ) : (
            <View style={{ marginTop: 18, height: 48, borderRadius: 10, backgroundColor: '#F1F5F9', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: '#E2EAF4' }}>
              <ShieldOff size={16} color="#94A3B8" />
              <Text style={{ color: '#94A3B8', fontSize: 15, fontWeight: '500' }}>仅管理员可保存修改</Text>
            </View>
          )}
        </ScrollView>
      )}

      {/* ── 保存成功 */}
      {stage === 'edit' && done && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14, backgroundColor: '#F5F7FA' }}>
          <View style={{ width: 64, height: 64, backgroundColor: '#D1FAE5', borderRadius: 32, alignItems: 'center', justifyContent: 'center' }}>
            <Check size={30} color="#16A34A" />
          </View>
          <Text style={{ color: '#1A2332', fontSize: 17, fontWeight: '700' }}>修改成功</Text>
          <Text style={{ color: '#64748B', fontSize: 14, textAlign: 'center', lineHeight: 22 }}>
            车辆 <Text style={{ fontWeight: '600', color: '#1A2332' }}>{editVehicle?.plate_number}</Text> 信息已更新
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, width: '100%', marginTop: 8 }}>
            <Pressable onPress={handleReset}
              style={{ flex: 1, height: 46, borderRadius: 10, borderWidth: 1, borderColor: '#E2EAF4', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' }}>
              <Text style={{ color: '#64748B', fontWeight: '500' }}>继续修改</Text>
            </Pressable>
            <Pressable onPress={() => router.back()}
              style={{ flex: 1, height: 46, borderRadius: 10, backgroundColor: '#8B5CF6', alignItems: 'center', justifyContent: 'center' }}
              android_ripple={{ color: 'rgba(255,255,255,0.25)', borderless: false }}>
              <Text style={{ color: '#fff', fontWeight: '600' }}>返回首页</Text>
            </Pressable>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
