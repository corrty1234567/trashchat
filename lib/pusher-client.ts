import type Pusher from "pusher-js";
import type { Channel } from "pusher-js";
import { PUSHER_AUTH_ENDPOINT, PUSHER_CHANNEL } from "@/lib/realtime";

export function connectPrivateRealtime(
  key: string,
  cluster: string,
  bind: (pusher: Pusher, channel: Channel) => () => void,
  onError: () => void = () => {}
) {
  let stopped = false;
  let client: Pusher | undefined;
  let unbind: (() => void) | undefined;
  // The encrypted SDK is browser-only. Load it after mount, not during Next SSR.
  void import("pusher-js/with-encryption").then(({ default: EncryptedPusher }) => {
    if (stopped) return;
    client = new EncryptedPusher(key, {
      cluster,
      channelAuthorization: { endpoint: PUSHER_AUTH_ENDPOINT, transport: "ajax" }
    });
    unbind = bind(client, client.subscribe(PUSHER_CHANNEL));
  }).catch(() => {
    client?.disconnect();
    if (!stopped) onError();
  });
  return () => {
    stopped = true;
    unbind?.();
    client?.unsubscribe(PUSHER_CHANNEL);
    client?.disconnect();
  };
}
