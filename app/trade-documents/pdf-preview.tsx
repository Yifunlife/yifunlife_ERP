"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./trade-documents.module.css";

export default function PdfPreview({ url, onReady, onError }: { url: string; onReady: (url: string) => void; onError: (message: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    let destroy: (() => Promise<void>) | undefined;
    const canvases = container.current;
    canvases?.replaceChildren();
    setLoading(true);
    void (async () => {
      try {
        const [pdfjs, worker, response] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url"), fetch(url)]);
        if (!response.ok) throw new Error("PDF 读取失败，请刷新登录后重新打开单据");
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const task = pdfjs.getDocument({ data: new Uint8Array(await response.arrayBuffer()) });
        destroy = () => task.destroy();
        const pdf = await task.promise;
        for (let index = 1; index <= pdf.numPages && active; index++) {
          const page = await pdf.getPage(index);
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", `PDF 第 ${index} 页，共 ${pdf.numPages} 页`);
          const context = canvas.getContext("2d");
          if (!context) throw new Error("此浏览器无法显示 PDF，请换用支持画布的浏览器");
          await page.render({ canvasContext: context, canvas, viewport }).promise;
          if (active) canvases?.appendChild(canvas);
          page.cleanup();
        }
        if (active) { setLoading(false); onReady(url); }
      } catch (error) { if (active) { setLoading(false); onError((error as Error).message); } }
    })();
    return () => { active = false; void destroy?.(); canvases?.replaceChildren(); };
  }, [url, onReady, onError]);
  return <div className={styles.pdfViewer}>{loading && <p role="status">正在显示 PDF 全部页面…</p>}<div ref={container} /></div>;
}
