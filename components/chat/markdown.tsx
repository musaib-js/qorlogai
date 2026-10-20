"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Renders assistant output as GitHub-flavoured Markdown. Raw HTML is never rendered. */
export const Markdown = memo(function Markdown({ children }: { children: string }) {
  return (
    <div className="qor-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _n, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline-offset-4 hover:underline" />
          ),
          table: ({ node: _n, ...props }) => (
            <div className="my-3 overflow-x-auto rounded-xl border">
              <table {...props} />
            </div>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
