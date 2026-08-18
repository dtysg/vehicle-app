import { useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Car, Building2, Hash, Palette, Fuel, CreditCard, FileText, Tag, Pencil, Trash2, User } from 'lucide-react-native';
import { supabase } from '@/client/supabase';
import { useSession } from '@/ctx';

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

const TYPE_LABELS: Record<VehicleType, string> = {
  gasoline: '汽油车辆',
  diesel: '柴油车辆',
  lng: 'LNG车辆',
};

const TYPE_COLORS: Record<VehicleType, { bg: string; text: string; light: string; border: string }> = {
  gasoline: { bg: '#F97316', text: '#fff', light: '#FFF7ED', border: '#FED7AA' },
  diesel: { bg: '#16A34A', text: '#fff', light: '#F0FDF4', border: '#BBF7D0' },
  lng: { bg: '#0EA5E9', text: '#fff', light: '#F0F9FF', border: '#BAE6FD' },
};

// 仿真车牌
function LicensePlate({ plateNumber }: { plateNumber: string }) {
  const prefix = plateNumber.slice(0, 1);
  const rest = plateNumber.slice(1);
  return (
    <View style={{ flexDirection: 'row', alignSelf: 'center', borderRadius: 6, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)', height: 56 }}>
      <View style={{ backgroundColor: '#003A9B', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, height: 56, gap: 2 }}>
        <Text style={{ color: '#fff', fontWeight: '900', fontSize: 20, letterSpacing: 1 }}>{prefix}</Text>
        <View style={{ width: 24, height: 1.5, backgroundColor: 'rgba(255,255,255,0.5)', borderRadius: 1 }} />
      </View>
      <View style={{ backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, height: 56 }}>
        <Text style={{ color: '#0A1628', fontWeight: '900', fontSize: 26, letterSpacing: 7 }}>{rest}</Text>
      </View>
    </View>
  );
}

// 信息行组件
function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value?: string }) {
  if (!value) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#F8FAFC', gap: 14 }}>
      <View style={{ width: 36, height: 36, backgroundColor: '#EFF6FF', borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
        {icon}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: '#94A3B8', fontSize: 11, marginBottom: 3, letterSpacing: 0.3 }}>{label}</Text>
        <Text style={{ color: '#0F172A', fontSize: 15, fontWeight: '600' }}>{value}</Text>
      </View>
    </View>
  );
}

const TABLE_MAP: Record<VehicleType, string> = {
  gasoline: 'gasoline_vehicles',
  diesel: 'diesel_vehicles',
  lng: 'lng_vehicles',
};

export default function VehicleDetailPage() {
  const router = useRouter();
  const { isAdmin } = useSession();
  const { data } = useLocalSearchParams<{ data: string }>();
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);

  let vehicle: Vehicle | null = null;
  try {
    vehicle = JSON.parse(data || '{}') as Vehicle;
  } catch {
    vehicle = null;
  }

  if (!vehicle || !vehicle.plate_number) {
    return (
      <View style={{ flex: 1, backgroundColor: '#F4F5F7', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#94A3B8', fontSize: 16 }}>数据异常，请返回重试</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16, paddingHorizontal: 24, paddingVertical: 10, backgroundColor: '#0052CC', borderRadius: 2 }}>
          <Text style={{ color: '#fff', fontWeight: '600' }}>返回</Text>
        </Pressable>
      </View>
    );
  }

  const typeColor = TYPE_COLORS[vehicle._type];
  const typeLabel = TYPE_LABELS[vehicle._type];

  const handleEdit = () => {
    router.push({
      pathname: '/(app)/vehicle-form',
      params: { mode: 'edit', data: JSON.stringify(vehicle) },
    });
  };

  const handleDelete = async () => {
    if (!vehicle) return;
    setDeleting(true);
    setDeleteError('');
    const table = TABLE_MAP[vehicle._type];
    const { error } = await supabase.from(table).delete().eq('id', vehicle.id);
    if (error) {
      setDeleteError('删除失败，请稍后重试');
      setShowConfirm(false);
      setDeleting(false);
      return;
    }
    // 删除成功后，对该表所有记录按原 seq_no 升序重新连续编号（1, 2, 3...）
    try {
      const { data: rows } = await supabase
        .from(table)
        .select('id')
        .order('seq_no', { ascending: true });
      if (rows && rows.length > 0) {
        await Promise.all(
          rows.map((row, idx) =>
            supabase.from(table).update({ seq_no: idx + 1 }).eq('id', row.id)
          )
        );
      }
    } catch { /* 序号重排失败不影响主流程 */ }
    setDeleting(false);
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
      {/* Header */}
      <LinearGradient
        colors={['#0D1B4B', '#1A3A8F', '#0052CC']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ paddingTop: 56, paddingBottom: 24, paddingHorizontal: 16 }}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <Pressable onPress={() => router.back()}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 }}>
            <ArrowLeft size={16} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '500' }}>返回</Text>
          </Pressable>
          {/* 编辑/删除按钮 — 仅管理员可见 */}
          {isAdmin && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              onPress={handleEdit}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 }}
            >
              <Pencil size={14} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>编辑</Text>
            </Pressable>
            <Pressable
              onPress={() => setShowConfirm(true)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(239,68,68,0.75)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 }}
            >
              <Trash2 size={14} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>删除</Text>
            </Pressable>
          </View>
          )}
        </View>
        <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, marginBottom: 12, letterSpacing: 1, textTransform: 'uppercase' }}>车辆详情</Text>
        <LicensePlate plateNumber={vehicle.plate_number} />
        {/* 类别徽标 */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 14 }}>
          <View style={{ backgroundColor: typeColor.bg, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Car size={12} color={typeColor.text} />
            <Text style={{ color: typeColor.text, fontSize: 13, fontWeight: '700' }}>{typeLabel}</Text>
          </View>
        </View>
      </LinearGradient>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }}
      >
        {/* 基本信息卡片 */}
        <View style={{ backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#EDF2F7', paddingHorizontal: 16, paddingTop: 2, paddingBottom: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 8, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' }}>
            <View style={{ width: 28, height: 28, backgroundColor: '#EFF6FF', borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
              <Car size={15} color="#2563EB" />
            </View>
            <Text style={{ color: '#1E3A8A', fontSize: 14, fontWeight: '700', letterSpacing: 0.3 }}>基本信息</Text>
          </View>

          <InfoRow
            icon={<Hash size={15} color="#2563EB" />}
            label="序号"
            value={String(vehicle.seq_no)}
          />
          <InfoRow
            icon={<Building2 size={15} color="#2563EB" />}
            label="所属单位"
            value={vehicle.unit}
          />
          <InfoRow
            icon={<Car size={15} color="#2563EB" />}
            label="车牌号码"
            value={vehicle.plate_number}
          />
          <InfoRow
            icon={<Tag size={15} color="#2563EB" />}
            label="车型"
            value={vehicle.vehicle_model}
          />
          <InfoRow
            icon={<Palette size={15} color="#2563EB" />}
            label="车身颜色"
            value={vehicle.body_color}
          />
        </View>

        {/* 油品信息卡片 */}
        <View style={{ backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#EDF2F7', paddingHorizontal: 16, paddingTop: 2, paddingBottom: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 8, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' }}>
            <View style={{ width: 28, height: 28, backgroundColor: '#FFF7ED', borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
              <Fuel size={15} color="#F97316" />
            </View>
            <Text style={{ color: '#9A3412', fontSize: 14, fontWeight: '700', letterSpacing: 0.3 }}>油品信息</Text>
          </View>

          <InfoRow
            icon={<Fuel size={15} color="#F97316" />}
            label="所用油品"
            value={vehicle.fuel_type}
          />
          {vehicle.gas_grade ? (
            <InfoRow
              icon={<Tag size={15} color="#F97316" />}
              label="汽油标号"
              value={vehicle.gas_grade}
            />
          ) : null}
          <InfoRow
            icon={<CreditCard size={15} color="#F97316" />}
            label="所用油卡"
            value={vehicle.oil_card}
          />
          {vehicle.driver_name ? (
            <InfoRow
              icon={<User size={15} color="#F97316" />}
              label="司机姓名"
              value={vehicle.driver_name}
            />
          ) : null}
          {vehicle.remark ? (
            <InfoRow
              icon={<FileText size={15} color="#F97316" />}
              label="备注"
              value={vehicle.remark}
            />
          ) : null}
        </View>

        {/* 分类信息卡片 */}
        <View style={{ backgroundColor: typeColor.light, borderRadius: 16, borderWidth: 1, borderColor: typeColor.border, padding: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 42, height: 42, backgroundColor: typeColor.bg, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}>
              <Car size={20} color="#fff" />
            </View>
            <View>
              <Text style={{ color: '#64748B', fontSize: 11, letterSpacing: 0.5 }}>车辆分类</Text>
              <Text style={{ color: '#0F172A', fontSize: 16, fontWeight: '800', marginTop: 2 }}>{typeLabel}</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* 删除二次确认弹窗 — 仅管理员可触发 */}
      {isAdmin && showConfirm && (
        <View style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
        }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 24, marginHorizontal: 24, width: '88%' }}>
            <View style={{ alignItems: 'center', marginBottom: 16, gap: 10 }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center' }}>
                <Trash2 size={24} color="#EF4444" />
              </View>
              <Text style={{ color: '#0F172A', fontSize: 17, fontWeight: '800' }}>确认删除车辆</Text>
            </View>
            <Text style={{ color: '#64748B', fontSize: 14, lineHeight: 22, textAlign: 'center', marginBottom: 6 }}>
              确认删除 <Text style={{ color: '#0F172A', fontWeight: '700' }}>{vehicle.plate_number}</Text> 的信息？{'\n'}此操作不可撤销。
            </Text>
            {deleteError ? <Text style={{ color: '#EF4444', fontSize: 13, marginTop: 8, textAlign: 'center' }}>{deleteError}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
              <Pressable
                onPress={() => { setShowConfirm(false); setDeleteError(''); }}
                style={{ flex: 1, height: 46, borderRadius: 12, borderWidth: 1.5, borderColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFC' }}
              >
                <Text style={{ color: '#475569', fontWeight: '600', fontSize: 15 }}>取消</Text>
              </Pressable>
              <Pressable
                onPress={handleDelete}
                disabled={deleting}
                style={{ flex: 1, height: 46, borderRadius: 12, backgroundColor: '#EF4444', alignItems: 'center', justifyContent: 'center' }}
              >
                {deleting
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>确认删除</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
