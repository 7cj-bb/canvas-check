import type { CheckResult, ReadFile, Requirement } from './types';

export function runLocalChecks(requirements: Requirement[], files: ReadFile[], attachmentSetTrusted: boolean): CheckResult[] {
  return requirements.map(requirement => {
    const result: CheckResult = { requirement, status: 'confirm', detail: '需要 AI 理解或人工确认；本地初版不自动判断。', evidence: [] };
    if (requirement.conditional) return { ...result, detail: '原文含条件或可选表述，请先确认这一要求是否适用。' };
    if (requirement.kind === 'semantic') return result;
    if (requirement.kind === 'file') {
      const matches = files.filter(f => !f.origin && requirement.extensions?.includes(f.detectedFormat ?? f.extension));
      if (matches.length) return { ...result, status: 'found', detail: `当前附件清单中找到 ${matches.length} 个对应附件；不代表内容已满足要求。`, evidence: matches.map(f => ({ fileId: f.id, fileName: f.name, text: `${f.name} · ${f.size} 字节` })) };
      return { ...result, status: attachmentSetTrusted ? 'not-found' : 'uncheckable', detail: attachmentSetTrusted ? '所选提交范围内未找到对应格式。' : 'Canvas 附件尚未读取完整，暂不判断漏交。' };
    }
    const javaFiles = files.filter(f => f.kind === 'java');
    const locations = javaFiles.flatMap(f => {
      const evidence = requirement.kind === 'java-for' ? f.java?.forLoops ?? [] : f.java?.variables[requirement.variable ?? ''] ?? [];
      return evidence.map(e => ({ fileId: f.id, fileName: f.name, line: e.line, text: e.text }));
    });
    if (locations.length) return { ...result, status: 'found', detail: '已在实际语法结构中定位到对应内容，不评价算法正确性。', evidence: locations };
    if (!attachmentSetTrusted || !javaFiles.length || javaFiles.some(f => !f.java?.parsed)) {
      return { ...result, status: 'uncheckable', detail: 'Java 文件集合或语法读取不完整，相关结构暂不判断。' };
    }
    return { ...result, status: 'not-found', detail: '在本次读取的 Java 语法结构中未找到。' };
  });
}

export function selectionKey(files: ReadFile[]): string {
  return files.map(f => `${f.id}:${f.name}`).sort().join('|');
}

export function canUseResult(captured: string, current: string): boolean { return captured === current; }
