import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, Pressable, FlatList, ActivityIndicator,
  Image as RNImage, StyleSheet,
} from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming, Easing, interpolate,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Play, Pause, Search, X, ChevronDown, Music, Disc3, Heart, Trash2, ListMusic,
} from 'lucide-react-native';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import { supabase } from '@/client/supabase';

// ── 类型 ──────────────────────────────────────────────────────────────────
type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  artworkUrl: string;
  durationMs: number;
  source: string;
  playUrl?: string;
};

const STORAGE_KEY = '@music:last_track';
const FAV_KEY = '@music:favorites';

function fmt(ms: number): string {
  if (!ms || isNaN(ms) || ms <= 0) return '00:00';
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * 内嵌式音乐播放器：作为页面内容流式渲染，随页面滚动，绝不遮挡其他元素。
 * 平时只占一行迷你条；点搜索图标展开搜索面板。
 */
export default function MusicPlayer() {
  const player = useAudioPlayer();
  const status = useAudioPlayerStatus(player);

  const [showSearch, setShowSearch] = useState(false);
  const [panelTab, setPanelTab] = useState<'search' | 'fav'>('search');
  const [keyword, setKeyword] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<Track[]>([]);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState('');
  const [webUnlocked, setWebUnlocked] = useState(process.env.EXPO_OS !== 'web');
  const [autoLoaded, setAutoLoaded] = useState(false);
  const [favorites, setFavorites] = useState<Track[]>([]);
  // 收藏队列模式：记录当前播放的收藏列表索引
  const [favQueueIdx, setFavQueueIdx] = useState<number>(-1);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 歌词 ──
  type LyricLine = { time: number; text: string };
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [lyricLoading, setLyricLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: true,   // 切换 App 后继续播放
          interruptionMode: 'doNotMix',   // 独占音频焦点（锁屏控制必须）
        });
      } catch { /* Web 端不支持 */ }
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw && mounted) {
          const saved: Track = JSON.parse(raw);
          if (saved?.id) { setCurrentTrack(saved); setAutoLoaded(true); }
        }
      } catch { /* ignore */ }
      // 加载收藏列表
      try {
        const favRaw = await AsyncStorage.getItem(FAV_KEY);
        if (favRaw && mounted) setFavorites(JSON.parse(favRaw));
      } catch { /* ignore */ }
    })();
    return () => { mounted = false; };
  }, []);

  // 收藏持久化
  const saveFavorites = useCallback(async (list: Track[]) => {
    try { await AsyncStorage.setItem(FAV_KEY, JSON.stringify(list)); } catch { /* ignore */ }
  }, []);

  // 切换收藏
  const toggleFavorite = useCallback((track: Track) => {
    setFavorites(prev => {
      const exists = prev.some(f => f.id === track.id);
      const next = exists ? prev.filter(f => f.id !== track.id) : [...prev, track];
      saveFavorites(next);
      return next;
    });
  }, [saveFavorites]);

  // 删除收藏
  const removeFavorite = useCallback((trackId: string) => {
    setFavorites(prev => {
      const next = prev.filter(f => f.id !== trackId);
      saveFavorites(next);
      return next;
    });
    // 若正在用收藏队列播放该曲目，退出队列模式
    setFavQueueIdx(prev => prev >= 0 ? -1 : prev);
  }, [saveFavorites]);

  // 曲目结束：队列模式→播下一首；单曲模式→重播
  const favQueueIdxRef = useRef(favQueueIdx);
  const favoritesRef = useRef(favorites);
  useEffect(() => { favQueueIdxRef.current = favQueueIdx; }, [favQueueIdx]);
  useEffect(() => { favoritesRef.current = favorites; }, [favorites]);

  useEffect(() => {
    if (!status.didJustFinish) return;
    const idx = favQueueIdxRef.current;
    if (idx < 0) {
      // 单曲模式：回到开头重播
      try { player.seekTo(0); player.play(); } catch { /* ignore */ }
      return;
    }
    const list = favoritesRef.current;
    const nextIdx = idx + 1;
    if (nextIdx < list.length) {
      setFavQueueIdx(nextIdx);
      playTrackFromFav(list[nextIdx], nextIdx);
    } else {
      // 队列播完，退出队列模式
      setFavQueueIdx(-1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.didJustFinish]);
  useEffect(() => {
    if (!autoLoaded || !currentTrack) return;
    loadLyrics(currentTrack);
    if (process.env.EXPO_OS === 'web' && !webUnlocked) return;
    (async () => {
      const url = await resolveUrl(currentTrack);
      if (url) {
        try {
          player.replace({ uri: url }); (player as any).loop = false; player.play();
          // Android 后台超3分钟必须持有锁屏焦点，否则系统停止音频
          player.setActiveForLockScreen(true, {
            title: currentTrack.title, artist: currentTrack.artist,
            albumTitle: currentTrack.album, artworkUrl: currentTrack.artworkUrl,
          });
        } catch { /* ignore */ }
      }
    })();
  }, [autoLoaded, currentTrack, webUnlocked]);

  // 解析真实播放地址
  const resolveUrl = useCallback(async (track: Track): Promise<string | null> => {
    if (track.playUrl) return track.playUrl;
    setResolving(true); setError('');
    try {
      const { data, error } = await supabase.functions.invoke('music-resolve', {
        body: { songId: track.id, source: track.source }, method: 'POST',
      });
      if (error) {
        const msg = await error?.context?.text().catch(() => '');
        setError(msg || error.message || '解析失败');
        return null;
      }
      const url: string | null = data?.url ?? null;
      if (url) {
        setCurrentTrack(prev => prev && prev.id === track.id ? { ...prev, playUrl: url } : prev);
        return url;
      }
      setError(data?.message || '该曲目暂无法播放');
      return null;
    } catch (e: any) {
      setError(e?.message || '网络异常');
      return null;
    } finally {
      setResolving(false);
    }
  }, []);

  // 搜索（防抖 500ms）
  const doSearch = useCallback(async (kw: string) => {
    const q = kw.trim();
    if (!q) { setResults([]); setError(''); return; }
    setSearching(true); setError('');
    try {
      const { data, error } = await supabase.functions.invoke('music-search', {
        body: { keyword: q, limit: 20 }, method: 'POST',
      });
      if (error) {
        const msg = await error?.context?.text().catch(() => '');
        setError(msg || error.message || '搜索失败');
        setResults([]);
      } else if (data) {
        const tracks: Track[] = data.tracks ?? [];
        setResults(tracks);
        if (tracks.length === 0) setError(data.message || '未找到曲目');
      }
    } catch (e: any) {
      setError(e?.message || '网络异常');
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const onKeywordChange = (text: string) => {
    setKeyword(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => doSearch(text), 500);
  };

  // 搜索面板打开时，若已有关键词则自动重新搜索
  useEffect(() => {
    if (!showSearch) return;
    const kw = keyword.trim();
    if (kw) {
      setResults([]);
      setError('');
      doSearch(kw);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSearch]);

  // 加载歌词
  const loadLyrics = useCallback(async (track: Track) => {
    setLyricLoading(true);
    setLyrics([]);
    try {
      const { data, error } = await supabase.functions.invoke('music-lyrics', {
        body: { songId: track.id, source: track.source }, method: 'POST',
      });
      if (error) { setLyrics([]); return; }
      const lines: LyricLine[] = Array.isArray(data?.lines) ? data.lines : [];
      setLyrics(lines);
    } catch { setLyrics([]); }
    finally { setLyricLoading(false); }
  }, []);

  // 选中并播放（搜索结果）
  const playTrack = useCallback(async (track: Track) => {
    setFavQueueIdx(-1); // 退出收藏队列模式
    setError('');
    setCurrentTrack(track);
    setShowSearch(false);
    setWebUnlocked(true);
    loadLyrics(track);
    const url = await resolveUrl(track);
    if (url) {
      try {
        player.replace({ uri: url });
        (player as any).loop = false;
        player.play();
        player.setActiveForLockScreen(true, {
          title: track.title, artist: track.artist,
          albumTitle: track.album, artworkUrl: track.artworkUrl,
        });
      } catch { setError('播放失败'); }
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(track)).catch(() => {});
    }
  }, [player, resolveUrl, loadLyrics]);

  // 从收藏列表播放（进入队列模式）
  const playTrackFromFav = useCallback(async (track: Track, queueIdx: number) => {
    setError('');
    setCurrentTrack(track);
    setShowSearch(false);
    setWebUnlocked(true);
    loadLyrics(track);
    const url = await resolveUrl(track);
    if (url) {
      try {
        player.replace({ uri: url });
        (player as any).loop = false;
        player.play();
        player.setActiveForLockScreen(true, {
          title: track.title, artist: track.artist,
          albumTitle: track.album, artworkUrl: track.artworkUrl,
        });
      } catch { setError('播放失败'); }
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(track)).catch(() => {});
    }
    setFavQueueIdx(queueIdx);
  }, [player, resolveUrl, loadLyrics]);

  const togglePlay = useCallback(() => {
    setWebUnlocked(true);
    if (status.playing) {
      player.pause();
    } else if (currentTrack?.playUrl) {
      try {
        player.play();
        player.setActiveForLockScreen(true, {
          title: currentTrack.title, artist: currentTrack.artist,
          albumTitle: currentTrack.album, artworkUrl: currentTrack.artworkUrl,
        });
      } catch {}
    } else if (currentTrack) {
      resolveUrl(currentTrack).then(url => {
        if (url) {
          try {
            player.replace({ uri: url }); player.play();
            player.setActiveForLockScreen(true, {
              title: currentTrack.title, artist: currentTrack.artist,
              albumTitle: currentTrack.album, artworkUrl: currentTrack.artworkUrl,
            });
          } catch {}
        }
      });
    }
  }, [status.playing, currentTrack, player, resolveUrl]);

  const progressRatio = status.duration && status.duration > 0
    ? Math.min((status.currentTime ?? 0) / status.duration, 1) : 0;

  // 暂停时播放键呼吸光晕
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (currentTrack && !status.playing && !resolving) {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 900, easing: Easing.out(Easing.ease) }),
          withTiming(0, { duration: 900, easing: Easing.in(Easing.ease) }),
        ), -1, false,
      );
    } else { pulse.value = 0; }
  }, [currentTrack, status.playing, resolving]);
  const pulseStyle = useAnimatedStyle(() => ({
    shadowOpacity: interpolate(pulse.value, [0, 1], [0.15, 0.5]),
    shadowRadius: interpolate(pulse.value, [0, 1], [4, 14]),
  }));

  const isFav = !!currentTrack && favorites.some(f => f.id === currentTrack.id);
  const isPlaying = !!currentTrack && status.playing;

  // ── 当前歌词行（根据播放进度计算）──
  const currentTime = status.currentTime ?? 0;
  const currentLyricIndex = (() => {
    if (lyrics.length === 0) return -1;
    let idx = -1;
    for (let i = 0; i < lyrics.length; i++) {
      if (lyrics[i].time <= currentTime) idx = i; else break;
    }
    return idx;
  })();
  const currentLyricText = currentLyricIndex >= 0 ? lyrics[currentLyricIndex].text : '';
  const nextLyricText = currentLyricIndex >= 0 && currentLyricIndex + 1 < lyrics.length
    ? lyrics[currentLyricIndex + 1].text : '';
  const hasLyric = lyrics.length > 0;

  return (
    <View style={styles.container}>
      {/* 搜索 / 收藏面板 */}
      {showSearch && (
        <View style={styles.searchPanel}>
          {/* Tab 切换行 */}
          <View style={styles.tabRow}>
            <Pressable onPress={() => setPanelTab('search')}
              style={[styles.tabBtn, panelTab === 'search' && styles.tabBtnActive]}>
              <Search size={12} color={panelTab === 'search' ? '#60A5FA' : 'rgba(255,255,255,0.4)'} />
              <Text style={[styles.tabLabel, panelTab === 'search' && styles.tabLabelActive]}>搜索</Text>
            </Pressable>
            <Pressable onPress={() => setPanelTab('fav')}
              style={[styles.tabBtn, panelTab === 'fav' && styles.tabBtnFav]}>
              <Heart size={12} color={panelTab === 'fav' ? '#F87171' : 'rgba(255,255,255,0.4)'}
                fill={panelTab === 'fav' ? '#F87171' : 'none'} />
              <Text style={[styles.tabLabel, panelTab === 'fav' && styles.tabLabelFav]}>
                {'收藏' + (favorites.length > 0 ? `  ${favorites.length}` : '')}
              </Text>
            </Pressable>
          </View>

          {/* ── 搜索 Tab ── */}
          {panelTab === 'search' && (
            <>
              <View style={styles.searchBox}>
                <Search size={16} color="rgba(255,255,255,0.5)" />
                <TextInput
                  value={keyword} onChangeText={onKeywordChange}
                  placeholder="搜索歌曲 / 歌手" placeholderTextColor="rgba(255,255,255,0.35)"
                  style={styles.searchInput} returnKeyType="search" autoFocus
                />
                {keyword.length > 0 && (
                  <Pressable onPress={() => { setKeyword(''); setResults([]); setError(''); }} hitSlop={8}>
                    <X size={16} color="rgba(255,255,255,0.5)" />
                  </Pressable>
                )}
              </View>
              <View style={styles.resultListWrap}>
                {searching ? (
                  <View style={styles.centerHint}>
                    <ActivityIndicator size="small" color="#60A5FA" />
                    <Text style={styles.hintText}>搜索中…</Text>
                  </View>
                ) : error ? (
                  <View style={styles.centerHint}><Text style={styles.hintText}>{error}</Text></View>
                ) : results.length === 0 ? (
                  <View style={styles.centerHint}>
                    <Music size={28} color="rgba(255,255,255,0.2)" />
                    <Text style={styles.hintText}>输入关键词搜索全网音乐</Text>
                  </View>
                ) : (
                  <FlatList
                    data={results} keyExtractor={(item) => item.id}
                    renderItem={({ item }) => {
                      const isActive = currentTrack?.id === item.id;
                      const itemFaved = favorites.some(f => f.id === item.id);
                      return (
                        <Pressable onPress={() => playTrack(item)} style={styles.resultItem}>
                          <View style={styles.resultArtWrap}>
                            {item.artworkUrl
                              ? <RNImage source={{ uri: item.artworkUrl }} style={styles.resultArt} />
                              : <Disc3 size={18} color="rgba(255,255,255,0.3)" />}
                          </View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                              <Text style={[styles.resultTitle, isActive && { color: '#60A5FA' }]} numberOfLines={1}>{item.title}</Text>
                              <View style={[styles.sourceTag, item.source === 'qq' ? styles.sourceTagQQ : styles.sourceTagNE]}>
                                <Text style={styles.sourceTagText}>{item.source === 'qq' ? 'QQ' : '云'}</Text>
                              </View>
                            </View>
                            <Text style={styles.resultArtist} numberOfLines={1}>{item.artist}</Text>
                          </View>
                          {/* 收藏按钮 */}
                          <Pressable onPress={() => toggleFavorite(item)} hitSlop={8} style={{ padding: 4 }}>
                            <Heart size={15} color={itemFaved ? '#F87171' : 'rgba(255,255,255,0.3)'}
                              fill={itemFaved ? '#F87171' : 'none'} />
                          </Pressable>
                          {isActive && isPlaying
                            ? <Pause size={16} color="#60A5FA" />
                            : isActive && resolving
                              ? <ActivityIndicator size="small" color="#60A5FA" />
                              : <Play size={16} color="rgba(255,255,255,0.5)" fill="rgba(255,255,255,0.5)" />}
                        </Pressable>
                      );
                    }}
                    style={{ maxHeight: 320 }} scrollEnabled nestedScrollEnabled
                  />
                )}
              </View>
            </>
          )}

          {/* ── 收藏 Tab ── */}
          {panelTab === 'fav' && (
            <View style={styles.resultListWrap}>
              {favorites.length === 0 ? (
                <View style={styles.centerHint}>
                  <Heart size={28} color="rgba(255,255,255,0.2)" />
                  <Text style={styles.hintText}>还没有收藏的歌曲</Text>
                  <Text style={[styles.hintText, { fontSize: 10, marginTop: -4 }]}>在搜索结果中点击 ♡ 收藏</Text>
                </View>
              ) : (
                <>
                  <View style={styles.favHeader}>
                    <ListMusic size={12} color="rgba(255,255,255,0.4)" />
                    <Text style={styles.favHeaderText}>点击歌曲从该位置顺序播放</Text>
                    {favQueueIdx >= 0 && (
                      <View style={styles.queueBadge}>
                        <Text style={styles.queueBadgeText}>队列 {favQueueIdx + 1}/{favorites.length}</Text>
                      </View>
                    )}
                  </View>
                  <FlatList
                    data={favorites} keyExtractor={(item) => item.id}
                    renderItem={({ item, index }) => {
                      const isActive = currentTrack?.id === item.id;
                      const isQueueCurrent = favQueueIdx === index;
                      return (
                        <Pressable onPress={() => playTrackFromFav(item, index)}
                          style={[styles.resultItem, isQueueCurrent && styles.resultItemQueue]}>
                          <Text style={styles.favIndex}>{index + 1}</Text>
                          <View style={styles.resultArtWrap}>
                            {item.artworkUrl
                              ? <RNImage source={{ uri: item.artworkUrl }} style={styles.resultArt} />
                              : <Disc3 size={18} color="rgba(255,255,255,0.3)" />}
                          </View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={[styles.resultTitle, isActive && { color: '#60A5FA' }]} numberOfLines={1}>{item.title}</Text>
                            <Text style={styles.resultArtist} numberOfLines={1}>{item.artist}</Text>
                          </View>
                          {/* 删除按钮 */}
                          <Pressable onPress={() => removeFavorite(item.id)} hitSlop={8} style={{ padding: 4 }}>
                            <Trash2 size={14} color="rgba(248,113,113,0.6)" />
                          </Pressable>
                          {isActive && isPlaying
                            ? <Pause size={15} color="#60A5FA" />
                            : isActive && resolving
                              ? <ActivityIndicator size="small" color="#60A5FA" />
                              : <Play size={15} color="rgba(255,255,255,0.4)" fill="rgba(255,255,255,0.4)" />}
                        </Pressable>
                      );
                    }}
                    style={{ maxHeight: 300 }} scrollEnabled nestedScrollEnabled
                  />
                </>
              )}
            </View>
          )}
        </View>
      )}

      {/* 迷你播放器条 */}
      <LinearGradient
        colors={['rgba(15,30,70,0.96)', 'rgba(8,16,42,0.98)']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={styles.bar}
      >
        <View style={styles.artWrap}>
          {currentTrack?.artworkUrl
            ? <RNImage source={{ uri: currentTrack.artworkUrl }} style={styles.art} />
            : <View style={styles.artPlaceholder}>
                {resolving ? <ActivityIndicator size="small" color="#60A5FA" /> : <Disc3 size={18} color="rgba(255,255,255,0.4)" />}
              </View>}
        </View>

        <View style={styles.infoWrap}>
          <Text style={styles.title} numberOfLines={1}>{currentTrack?.title ?? '背景音乐'}</Text>
          <View style={styles.progressRow}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progressRatio * 100}%` }]} />
            </View>
          </View>
          <Text style={styles.artist} numberOfLines={1}>
            {resolving ? '解析中…' : currentTrack
              ? `${currentTrack.artist}  ${fmt((status.currentTime ?? 0) * 1000)} / ${fmt(status.duration ? status.duration * 1000 : currentTrack.durationMs)}`
              : '点击右侧搜索选歌'}
          </Text>
        </View>

        {/* 右：❤️ + ▶ + 🔍 */}
        <View style={styles.btnGroup}>
          {currentTrack && (
            <Pressable onPress={() => toggleFavorite(currentTrack)} hitSlop={6} style={styles.ctrlBtn}>
              <Heart size={16} color={isFav ? '#F87171' : 'rgba(255,255,255,0.5)'}
                fill={isFav ? '#F87171' : 'none'} />
            </Pressable>
          )}
          <Animated.View style={[styles.playBtnWrap, pulseStyle]}>
            <Pressable onPress={togglePlay} disabled={!currentTrack}
              style={[styles.playBtn, !currentTrack && { opacity: 0.4 }]}>
              {resolving
                ? <ActivityIndicator size="small" color="#fff" />
                : status.playing
                  ? <Pause size={20} color="#fff" fill="#fff" />
                  : <Play size={20} color="#fff" fill="#fff" style={{ marginLeft: 2 }} />}
            </Pressable>
          </Animated.View>
          <Pressable onPress={() => setShowSearch(v => !v)} hitSlop={6}
            style={[styles.ctrlBtn, showSearch && { backgroundColor: 'rgba(96,165,250,0.18)' }]}>
            {showSearch ? <ChevronDown size={18} color="#60A5FA" /> : <Search size={17} color="rgba(255,255,255,0.7)" />}
          </Pressable>
        </View>
      </LinearGradient>

      {/* 歌词行 */}
      {currentTrack && (
        <View style={styles.lyricWrap}>
          {lyricLoading ? (
            <Text style={styles.lyricHint}>歌词加载中…</Text>
          ) : hasLyric ? (
            <>
              <Text style={styles.lyricCurrent} numberOfLines={1}>{currentLyricText || '♪'}</Text>
              <Text style={styles.lyricNext} numberOfLines={1}>{nextLyricText || ''}</Text>
            </>
          ) : (
            <Text style={styles.lyricHint}>该曲目暂无歌词</Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 8 },
  // 面板
  searchPanel: {
    backgroundColor: 'rgba(12,22,52,0.98)',
    borderRadius: 14, padding: 10, marginBottom: 6,
    borderWidth: 1, borderColor: 'rgba(96,165,250,0.22)',
  },
  // Tab 切换
  tabRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  tabBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  tabBtnActive: { backgroundColor: 'rgba(96,165,250,0.15)', borderWidth: 1, borderColor: 'rgba(96,165,250,0.3)' },
  tabBtnFav:   { backgroundColor: 'rgba(248,113,113,0.12)', borderWidth: 1, borderColor: 'rgba(248,113,113,0.3)' },
  tabLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: '700' },
  tabLabelActive: { color: '#60A5FA' },
  tabLabelFav:    { color: '#F87171' },
  // 搜索框
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10, paddingHorizontal: 12, height: 36,
    borderWidth: 1, borderColor: 'rgba(96,165,250,0.2)',
  },
  searchInput: { flex: 1, color: '#fff', fontSize: 13, padding: 0 },
  resultListWrap: { marginTop: 6 },
  centerHint: { alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 24 },
  hintText: { color: 'rgba(255,255,255,0.35)', fontSize: 12, textAlign: 'center' },
  resultItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 7, paddingHorizontal: 4, borderRadius: 8,
  },
  resultItemQueue: { backgroundColor: 'rgba(96,165,250,0.08)' },
  resultArtWrap: { width: 36, height: 36, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  resultArt: { width: 36, height: 36, borderRadius: 8 },
  resultTitle: { color: '#fff', fontSize: 13, fontWeight: '700' },
  resultArtist: { color: 'rgba(255,255,255,0.45)', fontSize: 11, marginTop: 1 },
  sourceTag: { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4, borderWidth: 0.5 },
  sourceTagNE: { backgroundColor: 'rgba(239,68,68,0.15)', borderColor: 'rgba(239,68,68,0.4)' },
  sourceTagQQ: { backgroundColor: 'rgba(34,197,94,0.15)', borderColor: 'rgba(34,197,94,0.4)' },
  sourceTagText: { color: 'rgba(255,255,255,0.7)', fontSize: 8, fontWeight: '800' },
  // 收藏列表专用
  favHeader: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4, paddingHorizontal: 2 },
  favHeaderText: { color: 'rgba(255,255,255,0.35)', fontSize: 10, flex: 1 },
  favIndex: { color: 'rgba(255,255,255,0.3)', fontSize: 10, width: 16, textAlign: 'center' },
  queueBadge: { backgroundColor: 'rgba(96,165,250,0.2)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  queueBadgeText: { color: '#60A5FA', fontSize: 9, fontWeight: '800' },
  // 播放器条
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 16, paddingHorizontal: 10, paddingVertical: 9,
    borderWidth: 1, borderColor: 'rgba(96,165,250,0.25)',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  artWrap: { width: 40, height: 40, borderRadius: 10, overflow: 'hidden' },
  art: { width: 40, height: 40, borderRadius: 10 },
  artPlaceholder: { width: 40, height: 40, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  infoWrap: { flex: 1, minWidth: 0, gap: 3 },
  title: { color: '#fff', fontSize: 13, fontWeight: '800', letterSpacing: 0.2 },
  progressRow: { flexDirection: 'row', alignItems: 'center' },
  progressTrack: { flex: 1, height: 2.5, borderRadius: 1.5, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 1.5, backgroundColor: '#60A5FA' },
  artist: { color: 'rgba(255,255,255,0.45)', fontSize: 10 },
  btnGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  playBtnWrap: { shadowColor: '#60A5FA', shadowOffset: { width: 0, height: 0 } },
  playBtn: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: '#2563EB',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: 'rgba(96,165,250,0.6)',
  },
  ctrlBtn: {
    width: 32, height: 32, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  // 歌词
  lyricWrap: { marginTop: 4, paddingHorizontal: 14, paddingVertical: 5, gap: 1 },
  lyricCurrent: { color: '#60A5FA', fontSize: 12, fontWeight: '800', textShadowColor: 'rgba(96,165,250,0.4)', textShadowRadius: 4 },
  lyricNext: { color: 'rgba(255,255,255,0.28)', fontSize: 11 },
  lyricHint: { color: 'rgba(255,255,255,0.3)', fontSize: 11, fontStyle: 'italic' },
});
