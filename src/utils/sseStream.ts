import { createParser, type EventSourceParser } from 'eventsource-parser';

export interface SSEOptions {
  onData: (data: string) => void;
  onCompleted?: (error?: Error) => void;
  onAborted?: () => void;
}

export const processSSEStream = (
  signal: AbortSignal | undefined,
  response: Response,
  options: SSEOptions
): void => {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder('utf-8');
  const parser: EventSourceParser = createParser({
    onEvent: (event) => {
      if (event.data) {
        for (const data of event.data.split('\n')) {
          options.onData(data);
        }
      }
    },
  });

  const read = (): void => {
    reader.read()
      .then((result) => {
        if (result.done) {
          options.onCompleted?.();
          return;
        }
        parser.feed(decoder.decode(result.value, { stream: true }));
        read();
      })
      .catch((error: Error) => {
        if (signal?.aborted) {
          options.onAborted?.();
        } else {
          options.onCompleted?.(error);
        }
      });
  };

  read();
};
