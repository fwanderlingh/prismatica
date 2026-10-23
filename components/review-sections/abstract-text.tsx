import { Fragment, type ReactNode } from "react";
import katex from "katex";

const inlineTags = { sub: "sub", sup: "sup", i: "i", b: "b", em: "em", strong: "strong" } as const;
type InlineTag = keyof typeof inlineTags;

// Only a fixed set of simple, non-nested tags is rendered; anything else stays literal text.
function renderPlainText(text: string, keyPrefix: number): ReactNode {
  return text.split(/(<(?:sub|sup|i|b|em|strong)>[^<]*<\/(?:sub|sup|i|b|em|strong)>)/gi).map((chunk, index) => {
    const match = /^<(sub|sup|i|b|em|strong)>([^<]*)<\/(sub|sup|i|b|em|strong)>$/i.exec(chunk);
    if (!match || match[1].toLowerCase() !== match[3].toLowerCase()) {
      return <Fragment key={`${keyPrefix}-${index}`}>{chunk}</Fragment>;
    }
    const Tag = inlineTags[match[1].toLowerCase() as InlineTag];
    return <Tag key={`${keyPrefix}-${index}`}>{match[2]}</Tag>;
  });
}

export function renderAbstractText(text: string): ReactNode {
  return text.split(/(\$[^$\n]+\$)/g).map((chunk, index) => {
    if (!chunk.startsWith("$") || !chunk.endsWith("$")) {
      return <Fragment key={index}>{renderPlainText(chunk, index)}</Fragment>;
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
      return <Fragment key={index}>{renderPlainText(chunk, index)}</Fragment>;
    }
  });
}
