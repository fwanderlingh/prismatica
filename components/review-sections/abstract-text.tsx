import { Fragment, type ReactNode } from "react";
import katex from "katex";

type PlainTextRenderer = (text: string) => ReactNode;

export function renderAbstractText(text: string, renderPlainText: PlainTextRenderer): ReactNode {
  return text.split(/(\$[^$\n]+\$)/g).map((chunk, index) => {
    if (!chunk.startsWith("$") || !chunk.endsWith("$")) {
      return <Fragment key={index}>{renderPlainText(chunk)}</Fragment>;
    }

    try {
      const html = katex.renderToString(chunk.slice(1, -1), {
        throwOnError: true,
        trust: false,
        maxExpand: 1000,
        maxSize: 10
      });
      return <span key={index} dangerouslySetInnerHTML={{ __html: html }} />;
    } catch {
      return <Fragment key={index}>{renderPlainText(chunk)}</Fragment>;
    }
  });
}
