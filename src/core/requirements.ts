import type { AssignmentSnapshot, Requirement } from './types';
export const IMAGE_EXTENSIONS = ['png','jpg','jpeg','webp','gif','bmp','avif','heic','heif'];
export function embeddedImageRequirement(text: string) { return /(?:pdf|docx?|word|pptx|powerpoint|xlsx|excel).{0,80}(?:contain|includ|with|embed|包含|放入|插入)|(?:screenshots?|截图|图片).{0,50}(?:in (?:a |the )?(?:pdf|word)|放入|插入|包含在)/i.test(text); }

function identifier(input: string): string {
  let value = 2166136261;
  for (const c of input) value = Math.imul(value ^ c.charCodeAt(0), 16777619);
  return (value >>> 0).toString(36);
}

/** Conservative bootstrap rules. These are explicitly labelled local, not AI output. */
export function extractLocalRequirements(assignment: AssignmentSnapshot): Requirement[] {
  const requirements: Requirement[] = [];
  const seen = new Set<string>();
  const add = (kind: Requirement['kind'], label: string, quote: string, extra: Partial<Requirement> = {}) => {
    const signature = `${kind}:${extra.variable ?? extra.extensions?.join(',') ?? label}`;
    if (seen.has(signature)) return;
    seen.add(signature);
    requirements.push({ id: identifier(signature + quote), kind, label, quote, ...extra });
  };
  const paragraphs = assignment.paragraphs.length ? assignment.paragraphs : assignment.description.split(/\n+/);
  const hasVariableList = /variables?\s+and\s+constants?|following\s+variables?|指定变量|以下变量/i.test(assignment.description);
  for (const raw of paragraphs) {
    const text = raw.trim();
    if (!text) continue;
    const conditional = /\bif\b|optional|for example|e\.g\.|例如|可选|如果|若|可以选择/i.test(text);
    const submission = /submit|upload|attach|turn\s+in|提交|上传|附上/i.test(text);
    if (submission) {
      if (/(?:pdf\s*(?:or|或者|或)\s*(?:word|docx)|(?:word|docx)\s*(?:or|或者|或)\s*pdf)/i.test(text)) {
        add('file', 'PDF 或 Word 文件', text, { extensions: ['pdf', 'docx'], conditional });
      } else {
        if (/\.java\b|java\s+(?:source\s+)?file|java\s*源/i.test(text)) add('file', 'Java 源文件', text, { extensions: ['java'], conditional });
        if (/\bpdf\b/i.test(text)) add('file', 'PDF 文件', text, { extensions: ['pdf'], conditional });
        if (/\bdocx\b|word\s+(?:document|file)|Word\s*文档/i.test(text)) add('file', 'Word 文档', text, { extensions: ['docx'], conditional });
      }
      if (/screenshots?|photos?|images?|截图|照片|图片/i.test(text)) {
        if (embeddedImageRequirement(text)) add('semantic','文档中包含截图或图片',text,{artifact:'image',conditional});
        else add('file', '截图或照片附件', text, { extensions: [...IMAGE_EXTENSIONS], artifact:'image',conditional });
      }
      if (/\.pptx\b|powerpoint|PPT\s*文件/i.test(text)) add('file','PowerPoint 文件',text,{extensions:['pptx'],conditional});
      if (/\.xlsx\b|excel|电子表格/i.test(text)) add('file','Excel 文件',text,{extensions:['xlsx'],conditional});
    }
    if (/for[ -]?loop|for\s*循环/i.test(text) && /using|use\b|must|required|rejected|使用|必须|要求/i.test(text)) {
      add('java-for', '包含 for 循环结构', text, { conditional });
    }
    if (/pseudocode|伪代码/i.test(text) && /write|include|place|must|required|without|编写|包含|附|要求/i.test(text)) {
      add('semantic', '包含伪代码', text, { artifact:'text',conditional });
    }
    if (hasVariableList) {
      const variable = text.match(/^([A-Za-z_$][\w$]*)\s*[:：]/)?.[1];
      if (variable) add('java-variable', `声明变量 ${variable}`, text, { variable, conditional });
    }
  }
  return requirements;
}

export function sourceFingerprint(assignment: AssignmentSnapshot): string {
  return JSON.stringify([assignment.key, assignment.title, assignment.attempt, assignment.description, assignment.permittedExtensions, assignment.submissionMode, assignment.submissionTypes, assignment.grading]);
}
