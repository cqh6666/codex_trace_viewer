import React from 'react';
import { cn } from '../lib/utils';

export interface MarkdownRendererProps {
  content: string;
  className?: string;
}

const MARKDOWN_PATTERNS = [
  /^#{1,6}\s/m,
  /(^|[\s([{])(\*\*|__)(?=\S)([\s\S]*?\S)\2(?=$|[\s,.;:!?)}\]])/,
  /(^|[\s([{])(\*|_)(?=\S)([\s\S]*?\S)\2(?=$|[\s,.;:!?)}\]])/,
  /\[([^\]]+)\]\(([^)]+)\)/,
  /```[\s\S]*?```/,
  /`[^`\n]+`/,
  /^\s*[-*+]\s/m,
  /^\s*\d+\.\s/m,
  /^\s*>\s/m,
  /^\s*[-*]\s+\[[ xX]\]\s/m,
  /^\s*\|.+\|.+$/m,
  /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/m,
  /\[\^([^\]]+)\]/,
];

const INLINE_TOKEN_REGEX = /(`[^`\n]+`)|(!?\[[^\]]+\]\([^)]+\))|(~~[^~]+~~)|(\*\*[^*\n]+\*\*)|(__(?:(?!__).)+__)|(\*[^*\n]+\*)|(_[^_\n]+_)/g;

const HEADING_TEXT_CLASSES: Record<number, string> = {
  1: 'text-orange-200 font-semibold',
  2: 'text-blue-200 font-semibold',
  3: 'text-sky-300 font-semibold',
  4: 'text-text-bright font-medium',
  5: 'text-text-primary font-medium',
  6: 'text-text-secondary font-medium',
};

function isDelimiterCharacter(char: string | undefined) {
  return !char || /[\s,.;:!?()[\]{}]/.test(char);
}

function hasMarkdownDelimiterBoundaries(text: string, startIndex: number, tokenLength: number) {
  const before = startIndex > 0 ? text[startIndex - 1] : undefined;
  const after = startIndex + tokenLength < text.length ? text[startIndex + tokenLength] : undefined;
  return isDelimiterCharacter(before) && isDelimiterCharacter(after);
}

function renderText(text: string, key: string, className = 'text-text-primary') {
  if (!text) {
    return null;
  }

  return (
    <span key={key} className={className}>
      {text}
    </span>
  );
}

function renderLinkToken(token: string, key: string) {
  const match = /^(!?)\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
  if (!match) {
    return renderText(token, key);
  }

  const [, bang, label, url] = match;

  return (
    <React.Fragment key={key}>
      {bang ? <span className="text-text-muted">!</span> : null}
      <span className="text-brand-blue">[</span>
      <span className="text-brand-blue font-medium">{label}</span>
      <span className="text-brand-blue">]</span>
      <span className="text-text-secondary">(</span>
      <span className="text-sky-300">{url}</span>
      <span className="text-text-secondary">)</span>
    </React.Fragment>
  );
}

function renderInlineCodeToken(token: string, key: string) {
  const codeText = token.slice(1, -1);

  return (
    <React.Fragment key={key}>
      <span className="text-emerald-500">`</span>
      <span className="rounded border border-emerald-500/20 bg-black/40 px-1 text-emerald-300">{codeText}</span>
      <span className="text-emerald-500">`</span>
    </React.Fragment>
  );
}

function renderWrappedToken(
  token: string,
  marker: string,
  key: string,
  markerClassName: string,
  contentClassName: string,
) {
  const content = token.slice(marker.length, -marker.length);

  return (
    <React.Fragment key={key}>
      <span className={markerClassName}>{marker}</span>
      <span className={contentClassName}>{content}</span>
      <span className={markerClassName}>{marker}</span>
    </React.Fragment>
  );
}

function renderInlineSyntax(text: string, keyPrefix: string, baseClassName = 'text-text-primary') {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let tokenIndex = 0;

  INLINE_TOKEN_REGEX.lastIndex = 0;

  while ((match = INLINE_TOKEN_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(renderText(text.slice(lastIndex, match.index), `${keyPrefix}-text-${tokenIndex}`, baseClassName));
    }

    const token = match[0];
    const tokenKey = `${keyPrefix}-token-${tokenIndex}`;
    const requiresDelimiterCheck =
      token.startsWith('~~') ||
      token.startsWith('**') ||
      token.startsWith('__') ||
      token.startsWith('*') ||
      token.startsWith('_');

    if (requiresDelimiterCheck && !hasMarkdownDelimiterBoundaries(text, match.index, token.length)) {
      nodes.push(renderText(token, tokenKey, baseClassName));
      lastIndex = INLINE_TOKEN_REGEX.lastIndex;
      tokenIndex += 1;
      continue;
    }

    if (token.startsWith('`')) {
      nodes.push(renderInlineCodeToken(token, tokenKey));
    } else if (token.startsWith('[') || token.startsWith('![')) {
      nodes.push(renderLinkToken(token, tokenKey));
    } else if (token.startsWith('~~')) {
      nodes.push(renderWrappedToken(token, '~~', tokenKey, 'text-text-muted', 'text-text-muted line-through opacity-70'));
    } else if (token.startsWith('**')) {
      nodes.push(renderWrappedToken(token, '**', tokenKey, 'text-purple-400', 'font-bold text-text-bright'));
    } else if (token.startsWith('__')) {
      nodes.push(renderWrappedToken(token, '__', tokenKey, 'text-purple-400', 'font-bold text-text-bright'));
    } else if (token.startsWith('*')) {
      nodes.push(renderWrappedToken(token, '*', tokenKey, 'text-purple-400', 'italic text-purple-300'));
    } else if (token.startsWith('_')) {
      nodes.push(renderWrappedToken(token, '_', tokenKey, 'text-purple-400', 'italic text-purple-300'));
    } else {
      nodes.push(renderText(token, tokenKey, baseClassName));
    }

    lastIndex = INLINE_TOKEN_REGEX.lastIndex;
    tokenIndex += 1;
  }

  if (lastIndex < text.length) {
    nodes.push(renderText(text.slice(lastIndex), `${keyPrefix}-tail`, baseClassName));
  }

  return nodes.length > 0 ? nodes : [renderText(text, `${keyPrefix}-plain`, baseClassName)];
}

function renderTableLine(line: string, keyPrefix: string) {
  const parts = line.split(/(\|)/);

  return parts.map((part, index) => {
    if (part === '|') {
      return (
        <span key={`${keyPrefix}-pipe-${index}`} className="text-text-secondary">
          |
        </span>
      );
    }

    if (/^\s*:?-{3,}:?\s*$/.test(part)) {
      return (
        <span key={`${keyPrefix}-rule-${index}`} className="text-brand-orange/80">
          {part}
        </span>
      );
    }

    return (
      <React.Fragment key={`${keyPrefix}-cell-${index}`}>
        {renderInlineSyntax(part, `${keyPrefix}-cell-inline-${index}`)}
      </React.Fragment>
    );
  });
}

function renderMarkdownLine(line: string, index: number, inCodeFence: boolean) {
  const lineKey = `line-${index}`;

  if (!line) {
    return {
      nextInCodeFence: inCodeFence,
      node: null,
    };
  }

  const codeFenceMatch = /^(\s*)(```+|~~~+)(\s*[\w-]+)?(.*)$/.exec(line);
  if (codeFenceMatch) {
    const [, indent, fence, language, trailing] = codeFenceMatch;
    return {
      nextInCodeFence: !inCodeFence,
      node: (
        <React.Fragment key={lineKey}>
          {renderText(indent, `${lineKey}-indent`, 'text-text-primary')}
          <span className="font-semibold text-brand-orange">{fence}</span>
          {language ? <span className="text-emerald-400">{language}</span> : null}
          {trailing ? <span className="text-text-muted">{trailing}</span> : null}
        </React.Fragment>
      ),
    };
  }

  if (inCodeFence) {
    return {
      nextInCodeFence: true,
      node: (
        <span key={lineKey} className="text-emerald-200/90">
          {line}
        </span>
      ),
    };
  }

  if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
    return {
      nextInCodeFence: false,
      node: (
        <span key={lineKey} className="text-brand-orange/70">
          {line}
        </span>
      ),
    };
  }

  const headingMatch = /^(\s*)(#{1,6})(\s+)(.*)$/.exec(line);
  if (headingMatch) {
    const [, indent, marker, spacing, text] = headingMatch;
    const level = marker.length;
    return {
      nextInCodeFence: false,
      node: (
        <React.Fragment key={lineKey}>
          {renderText(indent, `${lineKey}-indent`, 'text-text-primary')}
          <span className="font-semibold text-brand-orange">{marker}</span>
          <span className="text-text-secondary">{spacing}</span>
          {renderInlineSyntax(text, `${lineKey}-heading`, HEADING_TEXT_CLASSES[level] || 'text-text-primary font-medium')}
        </React.Fragment>
      ),
    };
  }

  const taskListMatch = /^(\s*)([-+*])(\s+)\[([ xX])\](\s+)(.*)$/.exec(line);
  if (taskListMatch) {
    const [, indent, bullet, spacing, checked, spacingAfterCheckbox, text] = taskListMatch;
    const isChecked = checked.toLowerCase() === 'x';
    return {
      nextInCodeFence: false,
      node: (
        <React.Fragment key={lineKey}>
          {renderText(indent, `${lineKey}-indent`, 'text-text-primary')}
          <span className="text-brand-orange">{bullet}</span>
          <span className="text-text-secondary">{spacing}</span>
          <span className="text-text-secondary">[</span>
          <span className={cn(isChecked ? 'text-emerald-400' : 'text-text-muted')}>
            {isChecked ? 'x' : ' '}
          </span>
          <span className="text-text-secondary">]</span>
          <span className="text-text-secondary">{spacingAfterCheckbox}</span>
          {renderInlineSyntax(text, `${lineKey}-task`, isChecked ? 'text-text-muted line-through opacity-70' : 'text-text-primary')}
        </React.Fragment>
      ),
    };
  }

  const orderedListMatch = /^(\s*)(\d+\.)(\s+)(.*)$/.exec(line);
  if (orderedListMatch) {
    const [, indent, marker, spacing, text] = orderedListMatch;
    return {
      nextInCodeFence: false,
      node: (
        <React.Fragment key={lineKey}>
          {renderText(indent, `${lineKey}-indent`, 'text-text-primary')}
          <span className="font-semibold text-brand-blue">{marker}</span>
          <span className="text-text-secondary">{spacing}</span>
          {renderInlineSyntax(text, `${lineKey}-ordered`)}
        </React.Fragment>
      ),
    };
  }

  const unorderedListMatch = /^(\s*)([-+*])(\s+)(.*)$/.exec(line);
  if (unorderedListMatch) {
    const [, indent, marker, spacing, text] = unorderedListMatch;
    return {
      nextInCodeFence: false,
      node: (
        <React.Fragment key={lineKey}>
          {renderText(indent, `${lineKey}-indent`, 'text-text-primary')}
          <span className="text-brand-orange">{marker}</span>
          <span className="text-text-secondary">{spacing}</span>
          {renderInlineSyntax(text, `${lineKey}-unordered`)}
        </React.Fragment>
      ),
    };
  }

  const blockquoteMatch = /^(\s*)(>+)(\s?)(.*)$/.exec(line);
  if (blockquoteMatch) {
    const [, indent, marker, spacing, text] = blockquoteMatch;
    return {
      nextInCodeFence: false,
      node: (
        <React.Fragment key={lineKey}>
          {renderText(indent, `${lineKey}-indent`, 'text-text-primary')}
          <span className="text-amber-400">{marker}</span>
          <span className="text-text-secondary">{spacing}</span>
          {renderInlineSyntax(text, `${lineKey}-quote`, 'text-amber-100/90 italic')}
        </React.Fragment>
      ),
    };
  }

  const footnoteMatch = /^(\s*)(\[\^[^\]]+\]:)(\s*)(.*)$/.exec(line);
  if (footnoteMatch) {
    const [, indent, marker, spacing, text] = footnoteMatch;
    return {
      nextInCodeFence: false,
      node: (
        <React.Fragment key={lineKey}>
          {renderText(indent, `${lineKey}-indent`, 'text-text-primary')}
          <span className="text-brand-blue">{marker}</span>
          <span className="text-text-secondary">{spacing}</span>
          {renderInlineSyntax(text, `${lineKey}-footnote`, 'text-text-muted')}
        </React.Fragment>
      ),
    };
  }

  if (/^\s*\|?.+\|.+$/.test(line)) {
    return {
      nextInCodeFence: false,
      node: <React.Fragment key={lineKey}>{renderTableLine(line, lineKey)}</React.Fragment>,
    };
  }

  return {
    nextInCodeFence: false,
    node: <React.Fragment key={lineKey}>{renderInlineSyntax(line, lineKey)}</React.Fragment>,
  };
}

export function detectMarkdown(content: string) {
  if (typeof content !== 'string') {
    return false;
  }

  const trimmed = content.trim();
  if (!trimmed) {
    return false;
  }

  return MARKDOWN_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  const normalizedContent = content.replace(/\r\n?/g, '\n');
  const lines = normalizedContent.split('\n');
  const renderedLines: React.ReactNode[] = [];
  let inCodeFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const result = renderMarkdownLine(lines[index], index, inCodeFence);
    inCodeFence = result.nextInCodeFence;
    renderedLines.push(
      <div key={`md-line-${index}`} className="min-h-[1.4em]">
        {result.node}
      </div>,
    );
  }

  return (
    <div className={cn('markdown-content whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed', className)}>
      {renderedLines}
    </div>
  );
}
