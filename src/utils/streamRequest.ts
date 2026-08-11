import { fetch } from 'expo/fetch';
import { processSSEStream } from './sseStream';

export const sendStreamRequest = async (options: {
  functionUrl: string;
  requestBody: unknown;
  supabaseAnonKey: string;
  onData: (data: string) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
  signal?: AbortSignal;
}): Promise<void> => {
  const { functionUrl, requestBody, supabaseAnonKey, onData, onComplete, onError, signal } = options;
  try {
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'apikey': supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal,
    });
    processSSEStream(signal, response, {
      onData,
      onCompleted: (error) => (error ? onError(error) : onComplete()),
      onAborted: () => {},
    });
  } catch (error) {
    if (!signal?.aborted) onError(error as Error);
  }
};
