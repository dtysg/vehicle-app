/**
 * useVoiceInput — 语音输入 Hook
 * 录音(expo-audio) → base64 → speech-recognition EF
 * EF 若返回 use_native=true（已迁移为免费降级版），
 * 则提示用户改用键盘手动输入（设备原生语音键盘免费可用）
 * App 平台直接使用 m4a；Web 平台转 wav
 */
import { useState, useRef, useCallback } from 'react';
import {
  useAudioRecorder,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
  IOSOutputFormat,
  AudioQuality,
  type RecordingOptions,
} from 'expo-audio';
import { fetch } from 'expo/fetch';
import { supabase } from '@/client/supabase';

const RECORDING_OPTIONS: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 64000,
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.HIGH,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: 'audio/webm', bitsPerSecond: 64000 },
};

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function convertToWav(arrayBuffer: ArrayBuffer): Promise<ArrayBuffer> {
  // Web-only: 使用 AudioContext 把 webm 转为 16000Hz WAV
  const audioCtx = new AudioContext({ sampleRate: 16000 });
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
  const pcm = audioBuffer.getChannelData(0);
  await audioCtx.close();
  const wav = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(wav);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return wav;
}

async function transcribeAudio(fileUri: string): Promise<string> {
  const fileResponse = await fetch(fileUri);
  const contentType = fileResponse.headers.get('content-type') ?? '';
  const rawBuffer = await fileResponse.arrayBuffer();

  const needsConversion = contentType.includes('webm') || fileUri.endsWith('.webm');
  const audioBuffer = needsConversion ? await convertToWav(rawBuffer) : rawBuffer;
  const format = needsConversion ? 'wav' : 'm4a';
  const len = audioBuffer.byteLength;
  const speech = arrayBufferToBase64(audioBuffer);

  const { data, error } = await supabase.functions.invoke('speech-recognition', {
    body: { speech, len, format, rate: 16000, cuid: 'vehicle-app-user' },
  });

  if (error) throw new Error(String(error));

  // EF 迁移为免费降级版后返回 use_native=true，引导用户改用系统键盘语音输入
  if (data?.use_native === true) {
    throw new Error('NATIVE_FALLBACK');
  }

  if (data?.err_no !== 0) throw new Error(data?.err_msg || '语音识别失败');
  return (data.result?.[0] ?? '') as string;
}

type VoiceState = 'idle' | 'recording' | 'processing' | 'error';

export function useVoiceInput(onResult: (text: string) => void) {
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const [state, setState] = useState<VoiceState>('idle');
  const [errMsg, setErrMsg] = useState('');
  const recordingRef = useRef(false);

  const start = useCallback(async () => {
    if (recordingRef.current) return;
    setErrMsg('');
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) { setErrMsg('需要麦克风权限才能使用语音输入'); setState('error'); return; }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      recordingRef.current = true;
      setState('recording');
    } catch {
      setState('error');
      setErrMsg('录音启动失败，请重试');
    }
  }, [recorder]);

  const stop = useCallback(async () => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setState('processing');
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error('未获取到录音文件');
      const text = await transcribeAudio(uri);
      if (text) onResult(text);
      else setErrMsg('未识别到语音内容，请重试');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'NATIVE_FALLBACK') {
        // EF 降级：提示用户使用系统键盘麦克风（长按键盘麦克风图标即可语音输入，完全免费）
        setErrMsg('请使用键盘上的麦克风🎤进行语音输入（长按键盘麦克风键）');
      } else {
        setErrMsg('语音识别失败，请重试');
      }
      setState('error');
      return;
    }
    setState('idle');
  }, [recorder, onResult]);

  const cancel = useCallback(async () => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    try { await recorder.stop(); } catch { /* ignore */ }
    setState('idle');
    setErrMsg('');
  }, [recorder]);

  return { state, errMsg, start, stop, cancel };
}
