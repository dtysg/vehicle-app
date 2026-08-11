import { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { ArrowLeft, Search, Trash2, Car, Building2, Hash, Palette, Fuel, CreditCard, FileText, Tag, AlertTriangle, X, ShieldOff, User } from 'lucide-react-native';
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

const TABLE_MAP: Record<VehicleType, string> = {
  gasoline: 'gasoline_vehicles',
  diesel: 'diesel_vehicles',
  lng: 'lng_vehicles',
};

const TYPE_LABELS: Record<VehicleType, string> = {
  gasoline: '汽油',
  diesel: '柴油',
  lng: 'LNG',
};

const TYPE_COLORS: Record<VehicleType, { bg: string; light: string }> = {
  gasoline: { bg: '#FF5630', light: '#FFF3F0' },
  diesel:   { bg: '#16A34A', light: '#F0FFF4' },
  lng:      { bg: '#16A34A', light: '#F0FFF4' },
};

export default function VehicleDeletePage() {
  const router = useRouter();
  const { session } = useSession();
  const isAdmin = true; // 无需登录，所有用户均有管理权限
  const inputRef = useRef<TextInput>(null);

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<Vehicle[]>([]);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState('');

  // 二次确认弹窗状态
  const [confirmVehicle, setConfirmVehicle] = useState<Vehicle | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const handleSearch = async () => {
    const q = query.trim();
    if (!q) { setSearchError('请输入车牌号'); return; }
    setSearching(true);
    setSearchError('');
    setResults([]);
    setSearched(false);

    try {
      const [gasRes, dieselRes, lngRes] = await Promise.all([
        supabase.from('gasoline_vehicles').select('*').ilike('plate_number', `%${q}%`),
        supabase.from('diesel_vehicles').select('*').ilike('plate_number', `%${q}%`),
        supabase.from('lng_vehicles').select('*').ilike('plate_number', `%${q}%`),
      ]);
      if (gasRes.error || dieselRes.error || lngRes.error) {
        setSearchError('查询失败，请稍后重试'); return;
      }
      const all: Vehicle[] = [
        ...(gasRes.data || []).map((v) => ({ ...v, _type: 'gasoline' as VehicleType })),
        ...(dieselRes.data || []).map((v) => ({ ...v, _type: 'diesel' as VehicleType })),
        ...(lngRes.data || []).map((v) => ({ ...v, _type: 'lng' as VehicleType })),
      ];
      // 去重（同一车牌多表存在时只保留一条）
      const seen = new Set<string>();
      const deduped = all.filter((v) => {
        const key = v.plate_number?.trim().toUpperCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setResults(deduped);
      setSearched(true);
    } catch {
      setSearchError('网络异常，请稍后重试');
    } finally {
      setSearching(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmVehicle) return;
    setDeleting(true);
    setDeleteError('');
    const { error } = await supabase
      .from(TABLE_MAP[confirmVehicle._type])
      .delete()
      .eq('id', confirmVehicle.id);
    setDeleting(false);
    if (error) {
      setDeleteError('删除失败，请稍后重试');
    } else {
      // 写操作日志
      await supabase.from('audit_logs').insert({
        operator_id: session?.id ?? 0,
        operator_name: session?.real_name ?? '未知',
        operator_role: session?.role ?? 'user',
        action: '删除',
        target_type: 'vehicle',
        target_desc: confirmVehicle.plate_number,
        detail: `删除${confirmVehicle.fuel_type}车辆，单位：${confirmVehicle.unit}`,
      });
      setResults((prev) => prev.filter((v) => !(v.id === confirmVehicle.id && v._type === confirmVehicle._type)));
      setConfirmVehicle(null);
      setDeleteError('');
    }
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setSearched(false);
    setSearchError('');
  };

  // 结果卡片
  const renderItem = ({ item }: { item: Vehicle }) => {
    const tc = TYPE_COLORS[item._type];
    return (
      <View style={{ backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#E2EAF4', marginBottom: 10, overflow: 'hidden' }}>
        {/* 顶部色条 */}
        <View style={{ height: 3, backgroundColor: tc.bg }} />
        <View style={{ padding: 14, gap: 8 }}>
          {/* 车牌 + 油品标签 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flexDirection: 'row', borderRadius: 2, overflow: 'hidden', borderWidth: 1.5, borderColor: '#CBD5E1', height: 38, alignSelf: 'flex-start' }}>
              <View style={{ backgroundColor: '#0052CC', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 }}>
                <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 14 }}>{item.plate_number.slice(0, 1)}</Text>
              </View>
              <View style={{ backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 }}>
                <Text style={{ color: '#1A2332', fontWeight: 'bold', fontSize: 16, letterSpacing: 3 }}>{item.plate_number.slice(1)}</Text>
              </View>
            </View>
            <View style={{ backgroundColor: tc.bg, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600' }}>{TYPE_LABELS[item._type]}车</Text>
            </View>
          </View>

          {/* 简要信息 */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {[
              { icon: <Hash size={12} color="#64748B" />, val: `序号 ${item.seq_no}` },
              { icon: <Building2 size={12} color="#64748B" />, val: item.unit },
              { icon: <Car size={12} color="#64748B" />, val: item.vehicle_model },
              { icon: <Palette size={12} color="#64748B" />, val: item.body_color },
              { icon: <Fuel size={12} color="#64748B" />, val: item.fuel_type },
              { icon: <CreditCard size={12} color="#64748B" />, val: item.oil_card },
              ...(item.driver_name ? [{ icon: <User size={12} color="#64748B" />, val: `司机：${item.driver_name}` }] : []),
              ...(item.gas_grade ? [{ icon: <Tag size={12} color="#64748B" />, val: item.gas_grade }] : []),
              ...(item.remark    ? [{ icon: <FileText size={12} color="#64748B" />, val: item.remark }] : []),
            ].map((r, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#F8FAFC', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3 }}>
                {r.icon}
                <Text style={{ color: '#475569', fontSize: 11 }}>{r.val}</Text>
              </View>
            ))}
          </View>

          {/* 删除按钮：仅管理员可操作 */}
          {isAdmin ? (
            <Pressable
              onPress={() => { setConfirmVehicle(item); setDeleteError(''); }}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#FFF3F0', borderWidth: 1, borderColor: '#FFD2C7', borderRadius: 8, paddingVertical: 10, marginTop: 2 }}
              android_ripple={{ color: 'rgba(255,86,48,0.15)', borderless: false }}
            >
              <Trash2 size={15} color="#EF4444" />
              <Text style={{ color: '#EF4444', fontWeight: '600', fontSize: 14 }}>删除此车辆</Text>
            </Pressable>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2EAF4', borderRadius: 8, paddingVertical: 10, marginTop: 2 }}>
              <ShieldOff size={14} color="#94A3B8" />
              <Text style={{ color: '#94A3B8', fontSize: 13 }}>仅管理员可删除</Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#F5F7FA' }}>
      {/* Header */}
      <LinearGradient
        colors={['#4A0A00', '#991B1B', '#EF4444']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ paddingTop: 56, paddingBottom: 20, paddingHorizontal: 16 }}
      >
        <Pressable onPress={() => router.back()} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          <ArrowLeft size={20} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 15 }}>返回</Text>
        </Pressable>
        <Text style={{ color: '#fff', fontSize: 20, fontWeight: 'bold' }}>删除车辆</Text>
        <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13, marginTop: 4 }}>模糊查询车牌号，选择车辆后确认删除</Text>
      </LinearGradient>

      {/* 搜索框 */}
      <View style={{ backgroundColor: '#F0F4FF', borderBottomWidth: 1, borderBottomColor: '#C7D7F5', paddingHorizontal: 16, paddingVertical: 14, gap: 10 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: '#C7D7F5', borderRadius: 8, backgroundColor: '#fff', height: 46, paddingHorizontal: 12, gap: 8 }}>
            <Search size={16} color="#6B8BC3" />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={(t) => { setQuery(t); setSearched(false); setSearchError(''); }}
              placeholder="输入车牌号（支持模糊搜索）"
              placeholderTextColor="#93ACCC"
              autoCapitalize="characters"
              returnKeyType="search"
              onSubmitEditing={handleSearch}
              style={{ flex: 1, fontSize: 15, color: '#1A2332' }}
            />
            {query.length > 0 && (
              <Pressable onPress={handleClear} hitSlop={8}>
                <X size={16} color="#93ACCC" />
              </Pressable>
            )}
          </View>
          <Pressable
            onPress={handleSearch}
            disabled={searching}
            style={{ width: 72, height: 46, backgroundColor: '#EF4444', borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}
            android_ripple={{ color: 'rgba(255,255,255,0.25)', borderless: false }}
          >
            {searching
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>查询</Text>}
          </Pressable>
        </View>
        {searchError ? <Text style={{ color: '#DC2626', fontSize: 13 }}>{searchError}</Text> : null}
      </View>

      {/* 结果列表 */}
      <FlatList
        data={results}
        keyExtractor={(item) => `${item._type}-${item.id}`}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          searched ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 6 }}>
              <View style={{ width: 3, height: 14, backgroundColor: '#EF4444', borderRadius: 2 }} />
              <Text style={{ color: '#475569', fontSize: 13 }}>
                {results.length > 0 ? `共找到 ${results.length} 辆匹配车辆` : '未找到该车牌号对应的车辆'}
              </Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          searched ? (
            <View style={{ alignItems: 'center', paddingTop: 32, gap: 8 }}>
              <Car size={40} color="#CBD5E1" />
              <Text style={{ color: '#94A3B8', fontSize: 14 }}>未找到匹配车辆</Text>
            </View>
          ) : (
            <View style={{ alignItems: 'center', paddingTop: 56, gap: 10 }}>
              <View style={{ width: 80, height: 80, backgroundColor: '#FFF3F0', borderRadius: 40, alignItems: 'center', justifyContent: 'center' }}>
                <Trash2 size={36} color="#FECACA" />
              </View>
              <Text style={{ color: '#64748B', fontSize: 15, fontWeight: '500', marginTop: 4 }}>请输入车牌号查询</Text>
              <Text style={{ color: '#94A3B8', fontSize: 13 }}>支持模糊搜索，支持部分车牌号</Text>
            </View>
          )
        }
      />

      {/* 二次确认弹窗 */}
      {confirmVehicle && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 14, padding: 24, marginHorizontal: 28, width: '86%' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <AlertTriangle size={18} color="#EF4444" />
              <Text style={{ color: '#1A2332', fontSize: 16, fontWeight: '700' }}>确认删除</Text>
            </View>
            <Text style={{ color: '#64748B', fontSize: 14, lineHeight: 22 }}>
              确认删除车牌 <Text style={{ color: '#1A2332', fontWeight: '700' }}>{confirmVehicle.plate_number}</Text> 的全部信息？{'\n'}此操作不可撤销，删除后将永久移除。
            </Text>
            {deleteError ? <Text style={{ color: '#EF4444', fontSize: 13, marginTop: 8 }}>{deleteError}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
              <Pressable
                onPress={() => { setConfirmVehicle(null); setDeleteError(''); }}
                style={{ flex: 1, height: 44, borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ color: '#64748B', fontWeight: '500' }}>取消</Text>
              </Pressable>
              <Pressable
                onPress={handleDelete}
                disabled={deleting}
                style={{ flex: 1, height: 44, borderRadius: 8, backgroundColor: '#EF4444', alignItems: 'center', justifyContent: 'center' }}
                android_ripple={{ color: 'rgba(255,255,255,0.25)', borderless: false }}
              >
                {deleting
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={{ color: '#fff', fontWeight: '700' }}>确认删除</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

