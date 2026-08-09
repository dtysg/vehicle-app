import { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Check, Camera } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { fetch } from 'expo/fetch';
import { supabase } from '@/client/supabase';
import { useSession } from '@/ctx';

// ── 内联琴键按钮（供类别/标号选择用）────────────────────────────
function PianoKeyItem({ label, color, bgTop, bgBottom, active, onPress }: {
  label: string; color: string; bgTop: string; bgBottom: string;
  active: boolean; onPress: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable onPress={onPress} onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)} style={{ flex: 1 }}>
      <View style={{
        height: 40,
        borderBottomLeftRadius: 8, borderBottomRightRadius: 8,
        overflow: 'hidden',
        transform: [{ translateY: pressed ? 2 : 0 }],
        backgroundColor: pressed ? bgBottom : (active ? bgTop : bgBottom),
        justifyContent: 'flex-end', alignItems: 'center',
        paddingBottom: 8,
        borderWidth: 1,
        borderColor: active ? `${color}90` : `${color}35`,
      }}>
        {!pressed && (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 6, backgroundColor: `${color}40` }} />
        )}
        <Text style={{ color: active ? '#fff' : color, fontSize: 12, fontWeight: '700', zIndex: 1 }}>{label}</Text>
      </View>
    </Pressable>
  );
}

type VehicleType = 'gasoline' | 'diesel' | 'lng';

interface VehicleFormData {
  id?: number;
  unit: string;
  plate_number: string;
  vehicle_model: string;
  body_color: string;
  fuel_type: string;
  gas_grade: string;
  oil_card: string;
  driver_name: string;
  remark: string;
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

const TYPE_COLORS: Record<VehicleType, string> = {
  gasoline: '#FF5630',
  diesel: '#16A34A',
  lng: '#16A34A',
};

// ── FormField：车牌号带拍照按钮，其他字段只有文本输入 ────────────
// ── 工具函数：图片 base64 ──────────────────────────────────
async function imageToBase64(uri: string): Promise<string> {
  const resp = await fetch(uri);
  const buf = await resp.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// 中国车牌正则
const PLATE_REGEX = /[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤川青藏琼宁][A-Z][A-Z0-9]{5}/;

async function ocrPlate(uri: string): Promise<string> {
  const b64 = await imageToBase64(uri);
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const resp = await fetch(`${supabaseUrl}/functions/v1/accurate-ocr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${supabaseKey}`, apikey: supabaseKey },
    body: JSON.stringify({ image: b64, language_type: 'CHN_ENG' }),
  });
  if (!resp.ok) throw new Error('OCR 请求失败');
  const data = await resp.json();
  const words: string[] = (data.words_result ?? []).map((w: { words: string }) => w.words);
  for (const w of words) {
    const m = w.replace(/\s/g, '').toUpperCase().match(PLATE_REGEX);
    if (m) return m[0];
  }
  return words.sort((a, b) => b.length - a.length)[0] ?? '';
}

// ── FormField：车牌号带拍照按钮，其他字段只有文本输入 ────────────
function FormField({
  label, value, onChangeText, placeholder, required, autoCapitalize,
  onCamera, cameraLoading,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  onCamera?: () => void;
  cameraLoading?: boolean;
}) {
  return (
    <View style={{ marginBottom: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 7 }}>
        <Text style={{ color: '#374151', fontSize: 13, fontWeight: '600', letterSpacing: 0.2 }}>{label}</Text>
        {required && <Text style={{ color: '#EF4444', marginLeft: 3, fontSize: 14 }}>*</Text>}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder ?? `请输入${label}`}
          placeholderTextColor="#CBD5E1"
          autoCapitalize={autoCapitalize}
          style={{
            flex: 1, borderWidth: 1.5, borderColor: '#E2E8F0', borderRadius: 12,
            backgroundColor: '#FAFBFC', paddingHorizontal: 14, paddingVertical: 12,
            fontSize: 15, color: '#0F172A',
          }}
        />
        {/* 拍照 OCR 按钮（仅车牌号） */}
        {onCamera && (
          <Pressable
            onPress={onCamera}
            disabled={cameraLoading}
            style={{
              width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
              backgroundColor: '#F0FDF4', borderWidth: 1.5, borderColor: '#86EFAC',
            }}
          >
            {cameraLoading
              ? <ActivityIndicator size="small" color="#16A34A" />
              : <Camera size={20} color="#16A34A" />}
          </Pressable>
        )}
      </View>
    </View>
  );
}

export default function VehicleFormPage() {
  const router = useRouter();
  const { session } = useSession();
  const { mode, data } = useLocalSearchParams<{ mode: 'add' | 'edit'; data?: string }>();

  const initial: VehicleFormData = (() => {
    if (mode === 'edit' && data) {
      try {
        const v = JSON.parse(data);
        return {
          id: v.id,
          unit: v.unit ?? '',
          plate_number: v.plate_number ?? '',
          vehicle_model: v.vehicle_model ?? '',
          body_color: v.body_color ?? '',
          fuel_type: v.fuel_type ?? '',
          gas_grade: v.gas_grade ?? '',
          oil_card: v.oil_card ?? '',
          driver_name: v.driver_name ?? '',
          remark: v.remark ?? '',
          _type: v._type ?? 'gasoline',
        };
      } catch { /* empty */ }
    }
    return {
      unit: '', plate_number: '', vehicle_model: '',
      body_color: '', fuel_type: '', gas_grade: '', oil_card: '', driver_name: '', remark: '',
      _type: 'gasoline',
    };
  })();

  const [form, setForm] = useState<VehicleFormData>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 拍照 OCR 状态
  const [cameraLoading, setCameraLoading] = useState(false);

  // 车牌拍照 OCR
  const handleCamera = async () => {    setCameraLoading(true);
    setError('');
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') { setError('请授权相机权限以使用拍照识别功能'); return; }
      const result = await ImagePicker.launchCameraAsync({ allowsEditing: false, quality: 0.85 });
      if (result.canceled || !result.assets?.[0]) return;
      const compressed = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 1080 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      const uri = compressed.uri;
      const plate = await ocrPlate(uri);
      if (plate) setForm((p) => ({ ...p, plate_number: plate }));
      else setError('未能识别到车牌，请重新拍照或手动输入');
    } catch { setError('拍照识别失败，请手动输入车牌号'); }
    finally { setCameraLoading(false); }
  };

  const isEdit = mode === 'edit';
  const typeColor = TYPE_COLORS[form._type];
  const set = (key: keyof VehicleFormData) => (v: string) =>
    setForm((prev) => ({ ...prev, [key]: v }));

  // 防重复提交锁：避免快速双击保存按钮触发两次 insert
  const submittingRef = useRef(false);

  const handleSave = async () => {
    if (submittingRef.current) return; // 已在提交中，直接忽略
    const plate = form.plate_number.trim();
    if (!plate) { setError('车牌号码为必填项'); return; }
    submittingRef.current = true;
    setLoading(true);
    setError('');
    const table = TABLE_MAP[form._type];
    try {
      // 新增时自动取该表最大 seq_no + 1
      let seqNo: number | null = null;
      if (!isEdit) {
        const { data: maxRow } = await supabase
          .from(table)
          .select('seq_no')
          .order('seq_no', { ascending: false })
          .limit(1)
          .maybeSingle();
        seqNo = (maxRow?.seq_no ?? 0) + 1;
      }
      const payload: Record<string, unknown> = {
        unit: form.unit.trim() || '',
        plate_number: plate,
        vehicle_model: form.vehicle_model.trim() || null,
        body_color: form.body_color.trim() || null,
        fuel_type: form._type === 'gasoline' ? '汽油' : form._type === 'diesel' ? '柴油' : 'LNG',
        oil_card: form.oil_card.trim() || null,
        driver_name: form.driver_name.trim() || null,
      };
      if (!isEdit) payload.seq_no = seqNo;
      if (form._type === 'gasoline') payload.gas_grade = form.gas_grade.trim() || null;
      if (form._type === 'lng') payload.remark = form.remark.trim() || null;
      if (isEdit && form.id !== undefined) {
        const { error: err } = await supabase.from(table).update(payload).eq('id', form.id);
        if (err) throw err;
        // 写操作日志
        await supabase.from('audit_logs').insert({
          operator_id: session?.id ?? 0,
          operator_name: session?.real_name ?? '未知',
          operator_role: session?.role ?? 'user',
          action: '修改',
          target_type: 'vehicle',
          target_desc: plate,
          detail: `修改${payload.fuel_type}车辆信息`,
        });
      } else {
        const { error: err } = await supabase.from(table).insert(payload);
        if (err) throw err;
        // 写操作日志
        await supabase.from('audit_logs').insert({
          operator_id: session?.id ?? 0,
          operator_name: session?.real_name ?? '未知',
          operator_role: session?.role ?? 'user',
          action: '新增',
          target_type: 'vehicle',
          target_desc: plate,
          detail: `新增${payload.fuel_type}车辆`,
        });
      }
      router.back();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate') || msg.includes('unique')) {
        setError('该车牌号已存在，请检查后重新输入');
      } else if (msg.includes('null value') || msg.includes('not-null') || msg.includes('violates not-null')) {
        setError('必填字段不能为空，请检查车牌号等必填项');
      } else {
        setError('保存失败：' + msg);
      }
    } finally { setLoading(false); submittingRef.current = false; }
  };

  return (
    <KeyboardAvoidingView
      behavior={process.env.EXPO_OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: '#F8FAFC' }}
    >
      {/* Header */}
      <LinearGradient
        colors={['#0D1B4B', '#1A3A8F', '#0052CC']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ paddingTop: 56, paddingBottom: 20, paddingHorizontal: 16 }}
      >
        <Pressable onPress={() => router.back()}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, alignSelf: 'flex-start' }}>
          <ArrowLeft size={16} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '500' }}>取消</Text>
        </Pressable>
        <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: 0.3 }}>
          {isEdit ? '编辑车辆信息' : '新增车辆'}
        </Text>
        <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, marginTop: 5 }}>
          车牌号可拍照识别，其他字段请手动输入
        </Text>
      </LinearGradient>

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
      >
        {/* 车辆类别选择 */}
        {!isEdit && (
          <View style={{ backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#EDF2F7', padding: 16, marginBottom: 14 }}>
            <Text style={{ color: '#374151', fontSize: 13, fontWeight: '600', marginBottom: 12, letterSpacing: 0.2 }}>
              车辆类别 <Text style={{ color: '#EF4444' }}>*</Text>
            </Text>
            {/* 琴键式类别选择 */}
            <View style={{ flexDirection: 'row', gap: 1.5, borderRadius: 12, overflow: 'hidden', backgroundColor: '#0A0F1E', borderWidth: 1.5, borderColor: '#E2E8F0' }}>
              {(['gasoline', 'diesel'] as VehicleType[]).map((t) => {
                const active = form._type === t;
                const keyColor = TYPE_COLORS[t];
                return (
                  <PianoKeyItem
                    key={t}
                    label={TYPE_LABELS[t]}
                    color={active ? '#fff' : keyColor}
                    bgTop={active ? keyColor : `${keyColor}30`}
                    bgBottom={active ? keyColor : `${keyColor}10`}
                    active={active}
                    onPress={() => setForm((p) => ({ ...p, _type: t }))}
                  />
                );
              })}
            </View>
          </View>
        )}

        {isEdit && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 8 }}>
            <View style={{ backgroundColor: typeColor, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 }}>
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{TYPE_LABELS[form._type]}</Text>
            </View>
            <Text style={{ color: '#94A3B8', fontSize: 12 }}>（类别不可修改）</Text>
          </View>
        )}

        {/* 表单卡片 */}
        <View style={{ backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#EDF2F7', padding: 16 }}>
          <FormField label="所属单位" value={form.unit} onChangeText={set('unit')} />
          <FormField label="车牌号码" value={form.plate_number} onChangeText={set('plate_number')}
            required autoCapitalize="characters" placeholder="如：津DC2268"
            onCamera={handleCamera} cameraLoading={cameraLoading} />
          <FormField label="车型" value={form.vehicle_model} onChangeText={set('vehicle_model')} />
          <FormField label="车身颜色" value={form.body_color} onChangeText={set('body_color')} />          {/* 所用油品：根据车辆类别自动固定，只读显示 */}
          <View style={{ marginBottom: 16 }}>
            <Text style={{ color: '#374151', fontSize: 13, fontWeight: '600', marginBottom: 7, letterSpacing: 0.2 }}>所用油品</Text>
            <View style={{
              borderWidth: 1.5, borderColor: '#E2E8F0', borderRadius: 12,
              backgroundColor: '#FAFBFC', paddingHorizontal: 14, paddingVertical: 12,
              flexDirection: 'row', alignItems: 'center', gap: 10,
            }}>
              <View style={{
                paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
                backgroundColor: form._type === 'gasoline' ? '#F97316' : '#16A34A',
              }}>
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
                  {form._type === 'gasoline' ? '汽油' : '柴油'}
                </Text>
              </View>
              <Text style={{ color: '#64748B', fontSize: 14 }}>
                {form._type === 'gasoline' ? '汽油' : '柴油'}
              </Text>
              <Text style={{ color: '#94A3B8', fontSize: 11, marginLeft: 'auto' }}>自动填入</Text>
            </View>
          </View>
          {/* 汽油标号：琴键式固定选项（仅汽油车辆显示） */}
          {form._type === 'gasoline' && (
            <View style={{ marginBottom: 16 }}>
              <Text style={{ color: '#374151', fontSize: 13, fontWeight: '600', marginBottom: 7, letterSpacing: 0.2 }}>汽油标号</Text>
              <View style={{ flexDirection: 'row', gap: 1.5, borderRadius: 12, overflow: 'hidden', backgroundColor: '#0A0F1E', borderWidth: 1.5, borderColor: '#E2E8F0' }}>
                {([
                  { label: '92号', color: '#F97316' },
                  { label: '95号', color: '#EF4444' },
                  { label: '98号', color: '#334155' },
                ] as { label: string; color: string }[]).map(({ label, color }) => {
                  const active = form.gas_grade === `${label}汽油`;
                  return (
                    <PianoKeyItem
                      key={label}
                      label={label}
                      color={active ? '#fff' : color}
                      bgTop={active ? color : `${color}30`}
                      bgBottom={active ? color : `${color}10`}
                      active={active}
                      onPress={() => setForm((p) => ({ ...p, gas_grade: `${label}汽油` }))}
                    />
                  );
                })}
              </View>
            </View>
          )}
          <FormField label="所用油卡" value={form.oil_card} onChangeText={set('oil_card')} />
          <FormField label="司机姓名" value={form.driver_name} onChangeText={set('driver_name')} />
          {form._type === 'lng' && (
            <FormField label="备注" value={form.remark} onChangeText={set('remark')} />
          )}
        </View>

        {error ? (
          <View style={{ backgroundColor: '#FEF2F2', borderRadius: 10, padding: 12, marginTop: 12, borderWidth: 1, borderColor: '#FECACA', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: '#DC2626', fontSize: 13, flex: 1 }}>{error}</Text>
          </View>
        ) : null}

        <Pressable onPress={handleSave} disabled={loading}
          style={{ marginTop: 20, backgroundColor: '#2563EB', borderRadius: 14, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          {loading ? <ActivityIndicator size="small" color="#fff" />
            : <><Check size={20} color="#fff" /><Text style={{ color: '#fff', fontWeight: '700', fontSize: 16, letterSpacing: 0.3 }}>保存车辆信息</Text></>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
