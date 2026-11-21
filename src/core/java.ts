import { lexAndParse } from 'java-parser';
import type { JavaAnalysis, JavaLocation } from './types';

interface Token { image: string; startLine?: number; startOffset: number }
interface Cst { name: string; children: Record<string, (Cst | Token)[]> }

export function analyzeJava(text: string): JavaAnalysis {
  const result: JavaAnalysis = { parsed: false, forLoops: [], variables: {}, comments: [] };
  const lines = text.split(/\r?\n/);
  const location = (token: Token): JavaLocation => ({ line: token.startLine ?? 1, text: lines[(token.startLine ?? 1) - 1] ?? token.image });
  try {
    const parsed = lexAndParse(text);
    const visit = (node: Cst) => {
      if (node.name === 'basicForStatement' || node.name === 'enhancedForStatement') {
        const token = node.children.For?.[0] as Token | undefined;
        if (token) result.forLoops.push(location(token));
      }
      if (node.name === 'variableDeclaratorId') {
        const token = node.children.Identifier?.[0] as Token | undefined;
        if (token) (result.variables[token.image] ??= []).push(location(token));
      }
      for (const nodes of Object.values(node.children)) for (const child of nodes) if ('name' in child) visit(child);
    };
    visit(parsed.cst as unknown as Cst);
    const comments = (parsed as unknown as { comments?: Token[] }).comments ?? [];
    result.comments = comments.map(location);
    result.parsed = true;
  } catch {
    result.error = '语法结构未能完整读取；相关检查暂不下结论。';
  }
  return result;
}
