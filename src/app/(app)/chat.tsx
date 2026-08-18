import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, Pressable, TextInput,
  KeyboardAvoidingView, ActivityIndicator, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import {
  ArrowLeft, MessageCircle, Send, ShieldCheck, ShieldHalf, User, Mail,
  Trash2, AlertTriangle,
} from 'lucide-react-native';
import { supabase } from '@/client/supabase';
import { useSession } from '@/ctx';
import { BubbleSkeleton } from '@/components/Skeleton';

type ChatMessage = {
  id: number;
  created_at: string;
  sender_id: string;
  sender_name: string;
  sender_role: string;
  content: string;
  is_recalled: boolean;
};

type DmTarget = { id: string; name: string; role: string } | null;

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  const isToday = d.toDateString() === new Date().toDateString();
  if (isToday) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function RoleIcon({ role, size = 12 }: { role: string; size?: number }) {
  if (role === 'admin') return <ShieldCheck size={size} color="#F59E0B" />;
  if (role === 'assistant') return <ShieldHalf size={size} color="#06B6D4" />;
  return <User size={size} color="#94A3B8" />;
}

function roleBadgeColor(role: string): string {
  if (role === 'admin') return '#F59E0B';
  if (role === 'assistant') return '#06B6D4';
  return '#94A3B8';
}

// ── 私信快速发送弹窗 ─────────────────────────────────────────────────────
function DmModal({
  target, session, onClose,
}: { target: DmTarget; session: { id: number; real_name: string; role: string } | null; onClose: () => void }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!text.trim() || !session || !target) return;
    setSending(true);
    await supabase.from('private_messages').insert({
      sender_id: session.id,
      sender_name: session.real_name,
      sender_role: session.role,
      receiver_id: Number(target.id),
      receiver_name: target.name,
      content: text.trim(),
    });
    setSending(false);
    onClose();
    router.push({
      pathname: '/(app)/private-chat',
      params: { peerId: target.id, peerName: target.name, peerRole: target.role },
    } as never);
  };

  if (!target) return null;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }} onPress={onClose}>
        <Pressable style={{ width: '100%', maxWidth: 340, backgroundColor: '#fff', borderRadius: 20, overflow: 'hidden' }} onPress={() => {}}>
          <LinearGradient colors={['#1D4ED8', '#3B82F6']} style={{ paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
              <RoleIcon role={target.role} size={18} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>发私信</Text>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>给「{target.name}」</Text>
            </View>
            <Mail size={18} color="rgba(255,255,255,0.6)" />
          </LinearGradient>
          <View style={{ padding: 18, gap: 14 }}>
            <TextInput
              value={text} onChangeText={setText}
              placeholder="输入消息内容..." placeholderTextColor="#94A3B8"
              multiline autoFocus
              style={{
                backgroundColor: '#F8FAFF', borderRadius: 14, padding: 14,
                fontSize: 14, color: '#1A2332', minHeight: 80, maxHeight: 120,
                borderWidth: 1.5, borderColor: '#E0EAFF', lineHeight: 20,
              }}
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable onPress={onClose} style={{ flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: '#F1F5F9', alignItems: 'center' }}>
                <Text style={{ color: '#64748B', fontWeight: '600', fontSize: 14 }}>取消</Text>
              </Pressable>
              <Pressable
                onPress={handleSend} disabled={sending || !text.trim()}
                style={{ flex: 2, paddingVertical: 12, borderRadius: 12, backgroundColor: text.trim() ? '#2563EB' : '#CBD5E1', alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}
              >
                {sending
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <><Send size={14} color="#fff" /><Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>发送并进入对话</Text></>}
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
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
  | { kind: 'msg'; key: string; msg: ChatMessage };

// 每隔 5 分钟插入一条时间分隔线
function buildListItems(msgs: ChatMessage[]): ListItem[] {
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

// ── 消息气泡 ──────────────────────────────────────────────────────────────
function AvatarButton({ msg, isMine, onLongPress }: { msg: ChatMessage; isMine: boolean; onLongPress: () => void }) {
  return (
    <Pressable
      onPress={() => {}}
      onLongPress={onLongPress} delayLongPress={300}
      style={{
        width: 38, height: 38, borderRadius: 19,
        backgroundColor: isMine ? '#DBEAFE' : '#F1F5F9',
        alignItems: 'center', justifyContent: 'center',
        borderWidth: 2, borderColor: isMine ? 'rgba(37,99,235,0.25)' : 'rgba(148,163,184,0.3)',
      }}
    >
      <RoleIcon role={msg.sender_role} size={17} />
    </Pressable>
  );
}

function MessageBubble({ msg, isMine, onAvatarLongPress, onRecall }: {
  msg: ChatMessage; isMine: boolean; onAvatarLongPress: () => void; onRecall: () => void;
}) {
  return (
    <Animated.View entering={FadeInUp.duration(250)} style={{ flexDirection: isMine ? 'row-reverse' : 'row', alignItems: 'flex-end', gap: 8, marginHorizontal: 14, marginBottom: 14 }}>
      <AvatarButton msg={msg} isMine={isMine} onLongPress={onAvatarLongPress} />
      <View style={{ maxWidth: '73%', gap: 4 }}>
        {/* 名字 + 时间 */}
        <View style={{ flexDirection: isMine ? 'row-reverse' : 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <RoleIcon role={msg.sender_role} size={10} />
            <Text style={{ color: roleBadgeColor(msg.sender_role), fontSize: 12, fontWeight: '700' }}>
              {msg.sender_name}
            </Text>
          </View>
          <Text style={{ color: '#B0BFCF', fontSize: 11 }}>{formatTime(msg.created_at)}</Text>
        </View>
        {/* 气泡 */}
        {msg.is_recalled ? (
          <View style={{
            borderRadius: 16, paddingHorizontal: 14, paddingVertical: 9,
            backgroundColor: 'rgba(148,163,184,0.08)',
            borderWidth: 1, borderColor: 'rgba(148,163,184,0.2)', borderStyle: 'dashed',
          }}>
            <Text style={{ color: '#94A3B8', fontSize: 13, fontStyle: 'italic' }}>消息已撤回</Text>
          </View>
        ) : (
          <Pressable
            onPress={() => {}}
            onLongPress={isMine ? onRecall : undefined}
            delayLongPress={500}
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

// ── 主频道页面 ────────────────────────────────────────────────────────────
export default function ChatScreen() {
  const router = useRouter();
  const { session } = useSession();
  const insets = useSafeAreaInsets();
  // Header 顶部留白：状态栏高度（iOS刘海/Android状态栏）
  const headerPaddingTop = Math.max(insets.top, 32);
  // 输入区底部留白：iPhone Home 指示条
  const inputPaddingBottom = insets.bottom > 0 ? insets.bottom + 4 : 12;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [dmTarget, setDmTarget] = useState<DmTarget>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [recallTarget, setRecallTarget] = useState<number | null>(null);
  const flatRef = useRef<FlatList<ListItem>>(null);

  const handleRecall = useCallback(async () => {
    if (recallTarget === null) return;
    await supabase.from('chat_messages').update({ is_recalled: true }).eq('id', recallTarget);
    setMessages((prev) => prev.map((m) => m.id === recallTarget ? { ...m, is_recalled: true } : m));
    setRecallTarget(null);
  }, [recallTarget]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('chat_messages').select('*')
        .eq('channel', 'general').order('created_at', { ascending: true }).limit(100);
      setMessages((data as ChatMessage[]) ?? []);
      setLoading(false);
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: false }), 100);
    })();
    const now = new Date().toISOString();
    if (process.env.EXPO_OS === 'web') localStorage.setItem('chat_last_seen', now);
  }, []);

  useEffect(() => {
    const channel = supabase.channel('chat_realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: 'channel=eq.general' }, (payload) => {
        const newMsg = payload.new as ChatMessage;
        setMessages((prev) => {
          if (prev.find((m) => m.id === newMsg.id)) return prev;
          return [...prev, newMsg];
        });
        setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 80);
      }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !session) return;
    setSending(true);
    setInputText('');
    await supabase.from('chat_messages').insert({
      sender_id: session.id, sender_name: session.real_name,
      sender_role: session.role, content: text, channel: 'general',
    });
    setSending(false);
  }, [inputText, session]);

  const handleClearMessages = useCallback(async () => {
    setClearing(true);
    await supabase.from('chat_messages').delete().eq('channel', 'general');
    setMessages([]);
    setClearing(false);
    setClearConfirm(false);
  }, []);

  const handleAvatarLongPress = useCallback((msg: ChatMessage) => {
    if (String(msg.sender_id) === String(session?.id)) return;
    setDmTarget({ id: String(msg.sender_id), name: msg.sender_name, role: msg.sender_role });
  }, [session]);

  return (
    <KeyboardAvoidingView
      behavior={process.env.EXPO_OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
      style={{ flex: 1, backgroundColor: '#EEF3FB' }}
    >
      {/* Header */}
      <LinearGradient colors={['#071428', '#0D2260', '#1040A0']} style={{ paddingTop: headerPaddingTop, paddingBottom: 12, paddingHorizontal: 16 }}>
        {/* 第一行：返回 + 标题 + 操作按钮 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable onPress={() => router.back()}
            style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
            <ArrowLeft size={17} color="#fff" />
          </Pressable>
          <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: 'rgba(99,163,255,0.18)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(99,163,255,0.3)' }}>
            <MessageCircle size={17} color="#93C5FD" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 0.2 }}>内部聊天</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: '#10B981' }} />
              <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10 }}>全体频道 · 实时同步</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {session?.role === 'admin' && (
              <Pressable onPress={() => setClearConfirm(true)}
                style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(239,68,68,0.15)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)' }}>
                <Trash2 size={15} color="#F87171" />
              </Pressable>
            )}
          </View>
        </View>
        {/* 第二行：提示文字 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, paddingLeft: 2 }}>
          <Mail size={10} color="rgba(255,255,255,0.3)" />
          <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>长按头像可发私信</Text>
        </View>
      </LinearGradient>

      {/* 消息区 */}
      {loading ? (
        <View style={{ paddingTop: 8, backgroundColor: '#EEF3FB', flex: 1 }}>
          {[0,1,2,3].map((i) => <BubbleSkeleton key={i} isMine={i % 2 === 1} />)}
        </View>
      ) : messages.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <View style={{ width: 72, height: 72, borderRadius: 24, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' }}>
            <MessageCircle size={34} color="#93C5FD" />
          </View>
          <Text style={{ color: '#64748B', fontSize: 15, fontWeight: '600' }}>暂无消息</Text>
          <Text style={{ color: '#94A3B8', fontSize: 13 }}>发送第一条消息，开启对话吧！</Text>
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
            const m = (item as unknown as { kind: 'msg'; key: string; msg: ChatMessage }).msg;
            return (
              <MessageBubble
                msg={m}
                isMine={String(m.sender_id) === String(session?.id)}
                onAvatarLongPress={() => handleAvatarLongPress(m)}
                onRecall={() => setRecallTarget(m.id)}
              />
            );
          }}
          contentContainerStyle={{ paddingTop: 18, paddingBottom: 16 }}
          contentInsetAdjustmentBehavior="automatic"
          onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })}
        />
      )}

      {/* 输入区 */}
      <View style={{
        flexDirection: 'row', alignItems: 'flex-end', gap: 10,
        backgroundColor: '#fff', paddingHorizontal: 14, paddingTop: 12,
        paddingBottom: inputPaddingBottom,
        borderTopWidth: 1, borderTopColor: '#E8EEF7',
        shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: -2 },
      }}>
        <TextInput
          value={inputText} onChangeText={setInputText}
          placeholder="发送消息…" placeholderTextColor="#B0BFCF"
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

      {/* 私信弹窗 */}
      {dmTarget && <DmModal target={dmTarget} session={session} onClose={() => setDmTarget(null)} />}

      {/* 清除确认弹窗 */}
      {clearConfirm && (
        <Modal transparent animationType="fade" visible onRequestClose={() => setClearConfirm(false)}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }} onPress={() => setClearConfirm(false)}>
            <Pressable style={{ width: '100%', maxWidth: 340, backgroundColor: '#fff', borderRadius: 20, overflow: 'hidden' }} onPress={() => {}}>
              <View style={{ padding: 24, alignItems: 'center', gap: 10 }}>
                <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center' }}>
                  <AlertTriangle size={26} color="#EF4444" />
                </View>
                <Text style={{ fontSize: 17, fontWeight: '800', color: '#1E293B' }}>清除全部聊天记录？</Text>
                <Text style={{ fontSize: 13, color: '#64748B', textAlign: 'center', lineHeight: 20 }}>
                  将删除全体频道所有消息，{'\n'}此操作不可撤销。
                </Text>
              </View>
              <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#F1F5F9' }}>
                <Pressable onPress={() => setClearConfirm(false)} style={{ flex: 1, paddingVertical: 14, alignItems: 'center', borderRightWidth: 1, borderRightColor: '#F1F5F9' }}>
                  <Text style={{ color: '#64748B', fontWeight: '600', fontSize: 15 }}>取消</Text>
                </Pressable>
                <Pressable onPress={handleClearMessages} disabled={clearing} style={{ flex: 1, paddingVertical: 14, alignItems: 'center' }}>
                  {clearing ? <ActivityIndicator size="small" color="#EF4444" /> : <Text style={{ color: '#EF4444', fontWeight: '700', fontSize: 15 }}>确认清除</Text>}
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* 撤回确认弹窗 */}
      {recallTarget !== null && (
        <Modal transparent animationType="fade" visible onRequestClose={() => setRecallTarget(null)}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' }} onPress={() => setRecallTarget(null)}>
            <Pressable style={{ width: 280, backgroundColor: '#fff', borderRadius: 20, overflow: 'hidden' }} onPress={() => {}}>
              <View style={{ paddingHorizontal: 22, paddingTop: 24, paddingBottom: 8, alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 16, fontWeight: '800', color: '#1A2332' }}>撤回消息</Text>
                <Text style={{ fontSize: 13, color: '#64748B', textAlign: 'center' }}>撤回后所有人将看到"消息已撤回"</Text>
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
