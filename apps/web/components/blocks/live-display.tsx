"use client";

import { useEffect, useRef, type RefObject } from "react";

import type { LiveFrame } from "@/lib/run";

export interface LiveDisplayProps {
  frameRef: RefObject<LiveFrame | null>;
  className?: string;
}

// Frames land in the ref; drawing on animation frames skips any that arrive mid-decode.
export function LiveDisplay({ frameRef, className }: LiveDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let raf = 0;
    let decoding = false;
    let drawnSeq = -1;

    const paint = () => {
      raf = requestAnimationFrame(paint);

      const frame = frameRef.current;
      const canvas = canvasRef.current;
      if (!frame || !canvas || decoding || frame.seq === drawnSeq) return;

      const comma = frame.src.indexOf(",");
      if (comma === -1) return;

      const seq = frame.seq;
      const base64 = frame.src.slice(comma + 1);
      const mime = frame.src.startsWith("data:image/png") ? "image/png" : "image/jpeg";

      decoding = true;

      let binary: string;
      try {
        binary = atob(base64);
      } catch {
        decoding = false;
        return;
      }

      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }

      createImageBitmap(new Blob([bytes], { type: mime }))
        .then((bitmap) => {
          const target = canvasRef.current;
          if (target === canvas) {
            if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
              canvas.width = bitmap.width;
              canvas.height = bitmap.height;
            }
            canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
          }
          bitmap.close();
          drawnSeq = seq;
        })
        .catch(() => {
          // A dropped frame is not worth surfacing; the next one will land.
        })
        .finally(() => {
          decoding = false;
        });
    };

    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, [frameRef]);

  return (
    <canvas
      ref={canvasRef}
      aria-label="Live view of the program's virtual display"
      role="img"
      className={className}
    />
  );
}
