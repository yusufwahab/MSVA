"use client";

import { useEffect, useRef, useState } from "react";

interface YTPlayer {
  getCurrentTime(): number;
  getDuration(): number;
  seekTo(s: number, allowSeekAhead: boolean): void;
  destroy(): void;
}
interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      playerVars?: Record<string, number | string>;
      events: { onReady?: () => void; onStateChange?: (e: { data: number }) => void };
    },
  ) => YTPlayer;
  PlayerState: { PLAYING: number; PAUSED: number; ENDED: number };
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;
function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT!);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => {
      apiPromise = null;
      reject(new Error("blocked"));
    };
    document.head.appendChild(s);
  });
  return apiPromise;
}

/**
 * Embeds a YouTube video and reports the playback position every few seconds, on pause/end,
 * and when the tab is hidden, so students can resume after an interruption.
 */
export function VideoPlayer({
  videoId,
  startSeconds,
  onProgress,
}: {
  videoId: string;
  startSeconds: number;
  onProgress: (positionSeconds: number, durationSeconds: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const cb = useRef(onProgress);
  const start = useRef(startSeconds);
  useEffect(() => {
    cb.current = onProgress;
  });

  useEffect(() => {
    let player: YTPlayer | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;
    const report = () => {
      if (!player) return;
      const d = Math.floor(player.getDuration() || 0);
      const p = Math.floor(player.getCurrentTime() || 0);
      if (d > 0) cb.current(p, d);
    };
    const onHide = () => document.visibilityState === "hidden" && report();

    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !host.current) return;
        const mount = document.createElement("div");
        host.current.replaceChildren(mount);
        player = new YT.Player(mount, {
          videoId,
          playerVars: { rel: 0, playsinline: 1, modestbranding: 1 },
          events: {
            onReady: () => {
              if (start.current > 5) player?.seekTo(start.current, true);
            },
            onStateChange: (e) => {
              clearInterval(timer);
              if (e.data === YT.PlayerState.PLAYING) timer = setInterval(report, 10_000);
              else if (e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.ENDED) report();
            },
          },
        });
      })
      .catch(() => !cancelled && setFailed(true));

    document.addEventListener("visibilitychange", onHide);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onHide);
      report();
      player?.destroy();
    };
  }, [videoId]);

  return (
    <div>
      <div className="aspect-video w-full overflow-hidden rounded-2xl border border-line bg-black" data-testid="video-frame">
        <div ref={host} className="h-full w-full [&>iframe]:h-full [&>iframe]:w-full" />
      </div>
      {failed && (
        <p className="mt-2 text-sm text-danger" role="alert">
          The video player could not load. Check your connection or any content blocker, then refresh this page. Progress is only saved when the embedded player is running.
        </p>
      )}
    </div>
  );
}
