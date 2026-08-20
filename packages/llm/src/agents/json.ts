/** 从模型输出中稳健提取 JSON 对象（容错前后缀与 markdown 代码块） */
export function extractJson<T>(text: string): T | null {
  if (!text) return null;
  const t = text.trim();
  const fenceRe = new RegExp('\`\`\`(?:json)?\\s*([\\s\\S]*?)\\s*\`\`\`');
  const fence = t.match(fenceRe);
  const candidate = fence ? fence[1]! : t;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}
