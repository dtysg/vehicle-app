import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, PackageOpen, Upload, TriangleAlert, FolderOpen, CheckCircle } from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '@/client/supabase';
import { CURRENT_VERSION_CODE } from '@/hooks/useApkUpdate';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export default function PublishVersionScreen() {
  const router = useRouter();
  const [versionName, setVersionName] = useState('');
  const [versionCode, setVersionCode] = useState(String(CURRENT_VERSION_CODE + 1));
  const [apkUrl, setApkUrl] = useState('');
  const [releaseNotes, setReleaseNotes] = useState('');
  const [isForce, setIsForce] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // APK 上传状态
  const [apkFileName, setApkFileName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadDone, setUploadDone] = useState(false);

  // 从设备选择并上传 APK 到 Supabase Storage
  const handlePickAndUpload = async () => {
    setError('');
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/vnd.android.package-archive', 'application/octet-stream', '*/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;

      const file = result.assets[0];
      const code = versionCode.trim() || String(CURRENT_VERSION_CODE + 1);
      const fileName = `v${code}-${Date.now()}.apk`;

      setApkFileName(file.name ?? fileName);
      setUploading(true);
      setUploadProgress(0);
      setUploadDone(false);

      // 使用 FileSystem.uploadAsync 流式上传，支持进度回调且不占用内存
      const uploadUrl = `${SUPABASE_URL}/storage/v1/object/app-releases/${fileName}`;
      const uploadResult = await FileSystem.uploadAsync(uploadUrl, file.uri, {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: {
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/vnd.android.package-archive',
          'x-upsert': 'true',
        },
        sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
      });

      if (uploadResult.status !== 200) {
        let msg = '上传失败';
        try { msg = JSON.parse(uploadResult.body)?.message ?? msg; } catch { /* ignore */ }
        setError(msg);
        return;
      }

      // 获取公开下载链接
      const { data: urlData } = supabase.storage
        .from('app-releases')
        .getPublicUrl(fileName);

      setApkUrl(urlData.publicUrl);
      setUploadDone(true);
      setUploadProgress(100);
    } catch (e) {
      setError(e instanceof Error ? e.message : '选择文件失败，请重试');
    } finally {
      setUploading(false);
    }
  };

  const handlePublish = async () => {
    if (!versionName.trim()) { setError('请输入版本名称，如 1.0.7'); return; }
    const code = parseInt(versionCode, 10);
    if (isNaN(code) || code <= CURRENT_VERSION_CODE) {
      setError(`版本号必须大于当前版本 ${CURRENT_VERSION_CODE}`);
      return;
    }
    if (!apkUrl.trim().startsWith('http')) { setError('请先上传 APK 或输入有效的下载链接'); return; }
    if (!releaseNotes.trim()) { setError('请填写更新内容'); return; }

    setLoading(true);
    setError('');
    try {
      const { error: dbErr } = await supabase.from('app_versions').insert({
        version_name: versionName.trim(),
        version_code: code,
        apk_url: apkUrl.trim(),
        release_notes: releaseNotes.trim(),
        is_force: isForce,
      });
      if (dbErr) { setError('发布失败：' + dbErr.message); return; }
      setSuccess(true);
    } catch {
      setError('网络异常，请检查网络后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient colors={['#0A1628', '#0D2147', '#0A1E3D']} style={{ flex: 1 }}>
      {/* 顶部导航 */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingTop: 56, paddingHorizontal: 20, paddingBottom: 16,
      }}>
        <Pressable onPress={() => router.back()} hitSlop={12}
          style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
          <ArrowLeft size={18} color="#94A3B8" />
        </Pressable>
        <Text style={{ color: '#F1F5F9', fontSize: 18, fontWeight: '800', flex: 1 }}>发布新版本</Text>
        <PackageOpen size={20} color="#60A5FA" />
      </View>

      <ScrollView contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled">

        {/* 说明卡片 */}
        <View style={{ backgroundColor: 'rgba(59,130,246,0.1)', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: 'rgba(96,165,250,0.25)', gap: 6 }}>
          <Text style={{ color: '#93C5FD', fontSize: 13, fontWeight: '700' }}>📋 发布流程</Text>
          <Text style={{ color: '#7DD3FC', fontSize: 12, lineHeight: 20 }}>
            1. 填写版本信息{'\n'}
            2. 点击「选择 APK 上传」，从设备选择构建好的 APK 文件{'\n'}
            3. 上传完成后点击发布 → 用户下次打开 App 自动收到更新提示
          </Text>
        </View>

        {/* 当前版本提示 */}
        <View style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
          <Text style={{ color: '#64748B', fontSize: 12 }}>
            当前安装版本号：<Text style={{ color: '#94A3B8', fontWeight: '700' }}>{CURRENT_VERSION_CODE}</Text>
            {'  '}新版本号需大于此值
          </Text>
        </View>

        {/* 版本名称 */}
        <Field label="版本名称" required hint='如 "1.0.7"'>
          <TextInput value={versionName} onChangeText={(t) => { setVersionName(t); setError(''); }}
            placeholder='如 1.0.7' placeholderTextColor="rgba(255,255,255,0.22)"
            style={{ flex: 1, color: '#fff', fontSize: 15, fontWeight: '600' }} />
        </Field>

        {/* 版本号 */}
        <Field label="版本号（数字）" required hint="必须大于当前版本号，用于版本比较">
          <TextInput value={versionCode} onChangeText={(t) => { setVersionCode(t); setError(''); }}
            keyboardType="numeric" placeholder="如 1298"
            placeholderTextColor="rgba(255,255,255,0.22)"
            style={{ flex: 1, color: '#fff', fontSize: 15, fontWeight: '600' }} />
        </Field>

        {/* APK 上传区域 */}
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '600', letterSpacing: 0.5 }}>APK 文件</Text>
            <Text style={{ color: '#EF4444', fontSize: 12 }}>*</Text>
          </View>

          {/* 上传按钮 */}
          <Pressable onPress={handlePickAndUpload} disabled={uploading}
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
              backgroundColor: uploadDone ? 'rgba(34,197,94,0.12)' : 'rgba(59,130,246,0.12)',
              borderRadius: 12, paddingVertical: 16,
              borderWidth: 1.5,
              borderColor: uploadDone ? 'rgba(34,197,94,0.4)' : 'rgba(96,165,250,0.35)',
              borderStyle: uploadDone ? 'solid' : 'dashed',
              opacity: uploading ? 0.7 : 1,
            }}>
            {uploading
              ? <ActivityIndicator color="#60A5FA" size="small" />
              : uploadDone
                ? <CheckCircle size={18} color="#34D399" />
                : <FolderOpen size={18} color="#60A5FA" />
            }
            <Text style={{ color: uploadDone ? '#34D399' : '#60A5FA', fontSize: 14, fontWeight: '700' }}>
              {uploading ? '正在上传…' : uploadDone ? `已上传：${apkFileName}` : '选择 APK 文件上传'}
            </Text>
          </Pressable>

          {/* 上传进度条 */}
          {(uploading || uploadDone) && (
            <View style={{ height: 4, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
              <View style={{
                height: 4, borderRadius: 2,
                backgroundColor: uploadDone ? '#34D399' : '#3B82F6',
                width: uploading ? '60%' : '100%',
              }} />
            </View>
          )}

          {/* 手动输入链接（备用） */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
            <Upload size={14} color="#475569" />
            <TextInput value={apkUrl} onChangeText={(t) => { setApkUrl(t); setError(''); setUploadDone(false); }}
              placeholder="或手动粘贴下载链接（https://…）"
              placeholderTextColor="rgba(255,255,255,0.18)"
              autoCapitalize="none" autoCorrect={false}
              style={{ flex: 1, color: '#7DD3FC', fontSize: 12 }} />
          </View>
        </View>

        {/* 更新内容 */}
        <Field label="更新内容" required>
          <TextInput value={releaseNotes}
            onChangeText={(t) => { setReleaseNotes(t); setError(''); }}
            placeholder="描述本次更新的主要内容…"
            placeholderTextColor="rgba(255,255,255,0.22)"
            multiline numberOfLines={4}
            style={{ flex: 1, color: '#CBD5E1', fontSize: 13, lineHeight: 20, minHeight: 80, textAlignVertical: 'top' }} />
        </Field>

        {/* 强制更新开关 */}
        <Pressable onPress={() => setIsForce(!isForce)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: isForce ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.08)' }}>
          <View style={{
            width: 22, height: 22, borderRadius: 6, borderWidth: 1.5,
            borderColor: isForce ? '#EF4444' : 'rgba(255,255,255,0.3)',
            backgroundColor: isForce ? 'rgba(239,68,68,0.25)' : 'transparent',
            alignItems: 'center', justifyContent: 'center',
          }}>
            {isForce && <Text style={{ color: '#F87171', fontSize: 14, fontWeight: '700', lineHeight: 18 }}>✓</Text>}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: isForce ? '#F87171' : '#94A3B8', fontSize: 14, fontWeight: '600' }}>强制更新</Text>
            <Text style={{ color: '#475569', fontSize: 11, marginTop: 2 }}>开启后用户无法跳过，必须更新才能继续使用</Text>
          </View>
          {isForce && <TriangleAlert size={16} color="#F87171" />}
        </Pressable>

        {/* 错误提示 */}
        {!!error && (
          <View style={{ backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)' }}>
            <Text style={{ color: '#F87171', fontSize: 13 }}>{error}</Text>
          </View>
        )}

        {/* 成功提示 */}
        {success && (
          <View style={{ backgroundColor: 'rgba(34,197,94,0.1)', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: 'rgba(34,197,94,0.3)', gap: 6 }}>
            <Text style={{ color: '#86EFAC', fontSize: 14, fontWeight: '700' }}>✅ 版本发布成功！</Text>
            <Text style={{ color: '#6EE7B7', fontSize: 12, lineHeight: 18 }}>
              用户下次打开 App 时将收到更新提示，点击即可下载 v{versionName}。
            </Text>
            <Pressable onPress={() => router.back()} style={{ marginTop: 4 }}>
              <Text style={{ color: '#34D399', fontSize: 13, fontWeight: '600' }}>← 返回首页</Text>
            </Pressable>
          </View>
        )}

        {/* 发布按钮 */}
        {!success && (
          <Pressable onPress={handlePublish} disabled={loading || uploading}
            style={{ backgroundColor: '#1D4ED8', borderRadius: 13, paddingVertical: 15, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10, borderWidth: 1, borderColor: 'rgba(96,165,250,0.4)', opacity: (loading || uploading) ? 0.7 : 1 }}>
            {loading
              ? <ActivityIndicator color="#fff" />
              : <>
                  <Upload size={17} color="#fff" />
                  <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: 0.5 }}>发布新版本</Text>
                </>
            }
          </Pressable>
        )}
      </ScrollView>
    </LinearGradient>
  );
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '600', letterSpacing: 0.5 }}>{label}</Text>
        {required && <Text style={{ color: '#EF4444', fontSize: 12 }}>*</Text>}
      </View>
      {hint && <Text style={{ color: '#475569', fontSize: 11 }}>{hint}</Text>}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, borderWidth: 1.5, borderColor: 'rgba(96,165,250,0.22)' }}>
        {children}
      </View>
    </View>
  );
}
