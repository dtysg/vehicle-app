import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, Pressable, TextInput,
  KeyboardAvoidingView, ActivityIndicator, Modal,
} from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft, Send, ShieldCheck, ShieldHalf, User, Lock,
} from 'lucide-react-native';
import { supabase } from '@/client/supabase';
import { useSession } from '@/ctx';
import { BubbleSkeleton } from '@/components/Skeleton';

// ── 消息类型 ──────────────────────────────────────────────────────────────
type PrivateMsg = {
  id: number;
  created_at: string;
  sender_id: number;
  sender_name: string;
  sender_role: string;
  receiver_id: number;
  receiver_name: string;
  content: string;
  is_read: boolean;
  is_recalled: boolean;
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  const isToday = d.toDateString() === new Date().toDateString();
  if (isToday) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function RoleIcon({ role, size = 14 }: { role: string; size?: number }) {
  if (role === 'admin') return <ShieldCheck size={size} color="#F59E0B" />;
  if (role === 'assistant') return <ShieldHalf size={size} color="#06B6D4" />;
  return <User size={size} color="#94A3B8" />;
}

function roleBadgeColor(role: string): string {
  if (role === 'admin') return '#F59E0B';
  if (role === 'assistant') return '#06B6D4';
  return '#94A3B8';
}

// ── 时间分隔线 ────────────────────────────────────────────────────────────
function formatDividerLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  if (isToday) return `今天 ${timeStr}`;
  if (isYesterday) return `昨天 ${timeStr}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${timeStr}`;
}

function TimeDivider({ label }: { label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginVertical: 10 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(148,163,184,0.2)' }} />
      <View style={{
        marginHorizontal: 10, backgroundColor: 'rgba(148,163,184,0.12)',
        borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3,
      }}>
        <Text style={{ color: '#94A3B8', fontSize: 11, fontWeight: '500' }}>{label}</Text>
      </View>
      <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(148,163,184,0.2)' }} />
    </View>
  );
}

type ListItem =
  | { kind: 'divider'; key: string; label: string }
  | { kind: 'msg'; key: string; msg: PrivateMsg };

// 每隔 5 分钟插入一条时间分隔线
function buildListItems(msgs: PrivateMsg[]): ListItem[] {
  const result: ListItem[] = [];
  let lastTs = 0;
  for (const msg of msgs) {
    const ts = new Date(msg.created_at).getTime();
    if (ts - lastTs > 5 * 60 * 1000) {
      result.push({ kind: 'divider', key: `div_${msg.id}`, label: formatDividerLabel(msg.created_at) });
      lastTs = ts;
    }
    result.push({ kind: 'msg', key: `msg_${msg.id}`, msg });
  }
  return result;
}

// ── 气泡组件 ──────────────────────────────────────────────────────────────
function Bubble({ msg, isMine, onRecall }: { msg: PrivateMsg; isMine: boolean; onRecall: () => void }) {
  return (
    <Animated.View entering={FadeInUp.duration(250)} style={{ flexDirection: isMine ? 'row-reverse' : 'row', alignItems: 'flex-end', gap: 8, marginHorizontal: 14, marginBottom: 14 }}>
      {/* 头像 */}
      <View style={{
        width: 38, height: 38, borderRadius: 19,
        backgroundColor: isMine ? '#DBEAFE' : '#F1F5F9',
        alignItems: 'center', justifyContent: 'center',
        borderWidth: 2, borderColor: isMine ? 'rgba(37,99,235,0.25)' : 'rgba(148,163,184,0.3)',
      }}>
        <RoleIcon role={msg.sender_role} size={17} />
      </View>

      <View style={{ maxWidth: '73%', gap: 4 }}>
        {/* 名字 + 时间 */}
        <View style={{ flexDirection: isMine ? 'row-reverse' : 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <RoleIcon role={msg.sender_role} size={10} />
            <Text style={{ color: roleBadgeColor(msg.sender_role), fontSize: 12, fontWeight: '700' }}>{msg.sender_name}</Text>
          </View>
          <Text style={{ color: '#B0BFCF', fontSize: 11 }}>{formatTime(msg.created_at)}</Text>
        </View>
        {/* 气泡 */}
        {msg.is_recalled ? (
          <View style={{ borderRadius: 16, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: 'rgba(148,163,184,0.08)', borderWidth: 1, borderColor: 'rgba(148,163,184,0.2)', borderStyle: 'dashed' }}>
            <Text style={{ color: '#94A3B8', fontSize: 13, fontStyle: 'italic' }}>消息已撤回</Text>
          </View>
        ) : (
          <Pressable
            onPress={() => {}}
            onLongPress={isMine ? onRecall : undefined} delayLongPress={500}
            style={{
              borderRadius: 18,
              borderBottomRightRadius: isMine ? 5 : 18,
              borderBottomLeftRadius: isMine ? 18 : 5,
              paddingHorizontal: 15, paddingVertical: 11,
              backgroundColor: isMine ? '#2563EB' : '#fff',
              shadowColor: isMine ? '#2563EB' : '#94A3B8',
              shadowOpacity: isMine ? 0.25 : 0.1,
              shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
            }}
          >
            <Text style={{ color: isMine ? '#fff' : '#1A2332', fontSize: 14, lineHeight: 21 }}>
              {msg.content}
            </Text>
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

// ── 私信页面 ──────────────────────────────────────────────────────────────
export default function PrivateChatScreen() {
  const router = useRouter();
  const { session } = useSession();
  const params = useLocalSearchParams<{ peerId: string; peerName: string; peerRole: string }>();
  const peerId = Number(params.peerId);
  const peerName = params.peerName ?? '对方';
  const peerRole = params.peerRole ?? 'user';

  const [messages, setMessages] = useState<PrivateMsg[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [recallTarget, setRecallTarget] = useState<number | null>(null);
  const flatRef = useRef<FlatList<ListItem>>(null);
  const myId = session?.id ?? 0;

  const handleRecall = useCallback(async () => {
    if (recallTarget === null) return;
    await supabase.from('private_messages').update({ is_recalled: true }).eq('id', recallTarget);
    setMessages((prev) => prev.map((m) => m.id === recallTarget ? { ...m, is_recalled: true } : m));
    setRecallTarget(null);
  }, [recallTarget]);

  const loadMessages = useCallback(async () => {
    const { data } = await supabase.from('private_messages').select('*')
      .or(`and(sender_id.eq.${myId},receiver_id.eq.${peerId}),and(sender_id.eq.${peerId},receiver_id.eq.${myId})`)
      .order('created_at', { ascending: true }).limit(150);
    setMessages((data as PrivateMsg[]) ?? []);
    setLoading(false);
    setTimeout(() => flatRef.current?.scrollToEnd({ animated: false }), 100);
    if (myId && peerId) {
      await supabase.from('private_messages').update({ is_read: true })
        .eq('sender_id', peerId).eq('receiver_id', myId).eq('is_read', false);
    }
  }, [myId, peerId]);

  useEffect(() => { (async () => { await loadMessages(); })(); }, [loadMessages]);

  useEffect(() => {
    const ch = supabase.channel(`pm_${Math.min(myId, peerId)}_${Math.max(myId, peerId)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'private_messages' }, (payload) => {
        const nm = payload.new as PrivateMsg;
        const inConv = (nm.sender_id === myId && nm.receiver_id === peerId) || (nm.sender_id === peerId && nm.receiver_id === myId);
        if (!inConv) return;
        setMessages((prev) => {
          if (prev.find((m) => m.id === nm.id)) return prev;
          return [...prev, nm];
        });
        setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 80);
        if (nm.sender_id === peerId) {
          supabase.from('private_messages').update({ is_read: true }).eq('id', nm.id).then(() => {});
        }
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [myId, peerId]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !session) return;
    setSending(true);
    setInputText('');
    await supabase.from('private_messages').insert({
      sender_id: myId, sender_name: session.real_name, sender_role: session.role,
      receiver_id: peerId, receiver_name: peerName, content: text,
    });
    setSending(false);
  }, [inputText, session, myId, peerId, peerName]);

  return (
    <KeyboardAvoidingView
      behavior={process.env.EXPO_OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: '#EEF3FB' }}
    >
      {/* Header */}
      <LinearGradient colors={['#071428', '#0D2260', '#1040A0']} style={{ paddingTop: 52, paddingBottom: 14, paddingHorizontal: 16, gap: 12 }}>
        {/* 第一行：返回 + 对方信息 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable onPress={() => router.back()}
            style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
            <ArrowLeft size={18} color="#fff" />
          </Pressable>
          <View style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.22)' }}>
            <RoleIcon role={peerRole} size={20} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 0.2 }}>{peerName}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Lock size={10} color="rgba(255,255,255,0.4)" />
              <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>私信对话 · 端到端保存</Text>
            </View>
          </View>
        </View>
      </LinearGradient>

      {/* 消息区 */}
      {loading ? (
        <View style={{ paddingTop: 8, backgroundColor: '#EEF3FB', flex: 1 }}>
          {[0,1,2,3].map((i) => <BubbleSkeleton key={i} isMine={i % 2 === 1} />)}
        </View>
      ) : messages.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <View style={{ width: 68, height: 68, borderRadius: 22, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' }}>
            <RoleIcon role={peerRole} size={30} />
          </View>
          <Text style={{ color: '#334155', fontSize: 15, fontWeight: '700' }}>{peerName}</Text>
          <Text style={{ color: '#94A3B8', fontSize: 13 }}>发送第一条私信吧！</Text>
        </View>
      ) : (
        <FlatList
          ref={flatRef}
          data={buildListItems(messages)}
          keyExtractor={(item) => item.key}
          renderItem={({ item }) => {
            if (item.kind === 'divider') {
              const d = item as { kind: 'divider'; key: string; label: string };
              return <TimeDivider label={d.label} />;
            }
            const m = (item as unknown as { kind: 'msg'; key: string; msg: PrivateMsg }).msg;
            return (
              <Bubble msg={m} isMine={m.sender_id === myId} onRecall={() => setRecallTarget(m.id)} />
            );
          }}
          contentContainerStyle={{ paddingTop: 18, paddingBottom: 10 }}
          contentInsetAdjustmentBehavior="automatic"
          onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })}
        />
      )}

      {/* 输入区 */}
      <View style={{
        flexDirection: 'row', alignItems: 'flex-end', gap: 10,
        backgroundColor: '#fff', paddingHorizontal: 14, paddingVertical: 12,
        borderTopWidth: 1, borderTopColor: '#E8EEF7',
        shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: -2 },
      }}>
        <TextInput
          value={inputText} onChangeText={setInputText}
          placeholder={`私信 ${peerName}…`} placeholderTextColor="#B0BFCF"
          multiline
          style={{
            flex: 1, color: '#1A2332', fontSize: 14, lineHeight: 20,
            backgroundColor: '#F0F5FF', borderRadius: 24,
            paddingHorizontal: 18, paddingTop: 11, paddingBottom: 11,
            maxHeight: 100, borderWidth: 1.5, borderColor: '#CCDCF8',
          }}
          returnKeyType="send" onSubmitEditing={handleSend} blurOnSubmit={false}
        />
        <Pressable
          onPress={handleSend} disabled={sending || !inputText.trim()}
          style={{
            width: 48, height: 48, borderRadius: 24,
            backgroundColor: inputText.trim() ? '#2563EB' : '#E2EBF8',
            alignItems: 'center', justifyContent: 'center',
            shadowColor: '#2563EB', shadowOpacity: inputText.trim() ? 0.35 : 0, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
          }}
          android_ripple={{ color: 'rgba(255,255,255,0.3)', borderless: false }}
        >
          {sending ? <ActivityIndicator size="small" color="#fff" /> : <Send size={20} color={inputText.trim() ? '#fff' : '#94A3B8'} />}
        </Pressable>
      </View>

      {/* 撤回确认弹窗 */}
      {recallTarget !== null && (
        <Modal transparent animationType="fade" visible onRequestClose={() => setRecallTarget(null)}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' }} onPress={() => setRecallTarget(null)}>
            <Pressable style={{ width: 280, backgroundColor: '#fff', borderRadius: 20, overflow: 'hidden' }} onPress={() => {}}>
              <View style={{ paddingHorizontal: 22, paddingTop: 24, paddingBottom: 8, alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 16, fontWeight: '800', color: '#1A2332' }}>撤回消息</Text>
                <Text style={{ fontSize: 13, color: '#64748B', textAlign: 'center' }}>撤回后对方将看到"消息已撤回"</Text>
              </View>
              <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#F1F5F9', marginTop: 16 }}>
                <Pressable onPress={() => setRecallTarget(null)} style={{ flex: 1, paddingVertical: 14, alignItems: 'center', borderRightWidth: 1, borderRightColor: '#F1F5F9' }}>
                  <Text style={{ color: '#64748B', fontWeight: '600', fontSize: 15 }}>取消</Text>
                </Pressable>
                <Pressable onPress={handleRecall} style={{ flex: 1, paddingVertical: 14, alignItems: 'center' }}>
                  <Text style={{ color: '#EF4444', fontWeight: '700', fontSize: 15 }}>撤回</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </KeyboardAvoidingView>
  );
}
