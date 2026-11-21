import type { AssignmentSnapshot } from './types';
import { translateText, type Language } from './i18n';

export interface AssignmentOverview { objective: string; constraints: string[]; method: 'local'; sourceExcerpt: boolean; translated?: boolean }

/** A transparent offline fallback. No model output is implied by this extractor. */
export function summarizeRequirements(assignment: AssignmentSnapshot, language: Language = 'zh-CN'): AssignmentOverview {
  const paragraphs = (assignment.paragraphs.length ? assignment.paragraphs : assignment.description.split(/\n+/)).map(p => p.trim()).filter(Boolean);
  const instruction = paragraphs.find(p => /write|create|build|design|编写|创建|完成|设计/i.test(p) && !/pseudocode|伪代码/i.test(p)) ?? paragraphs.find(p => !/^program name|^程序名/i.test(p)) ?? '';
  const text = assignment.description;
  let objective = instruction.replace(/^(?:your task is to|you (?:must|should|will)|你的任务是)\s*/i, '').replace(/\s+/g, ' ');
  const threeScores = /three\s+(?:integer\s+)?test\s+scores/i.test(text);
  const sequence = /sequence of integers|序列.*整数/i.test(text);
  if (threeScores && /average/i.test(text) && /letter grade/i.test(text)) objective = '输入 3 个整数成绩，计算平均分，并输出对应的字母等级。';
  else if (sequence && /largest/i.test(text) && /smallest/i.test(text)) objective = '读取一组整数，找出并输出最大值和最小值。';
  const constraints: string[] = [];
  const add = (value: string) => { if (!constraints.includes(value)) constraints.push(value); };
  if (/scores?.*(?:declared as int|declared int)/i.test(text)) add('成绩变量使用 int。');
  if (/average.*(?:declared as double|declared double)/i.test(text)) add('平均分使用 double，保留小数计算。');
  const thresholds = paragraphs.filter(p => /^[A-F]:\s*(?:Between|Below|[\d≥<>])/i.test(p));
  if (thresholds.length) add(thresholds.map(p => {
    const between = p.match(/^([A-F]):\s*Between\s+(\d+)\s+and\s+(\d+)/i);
    if (between) return `${between[1]}：${between[2]}–${new RegExp(`exclude\\s+${between[3]}\\b`, 'i').test(p) ? '<' : ''}${between[3]}`;
    return p.replace(/Below /i, '<');
  }).join('；'));
  if (/for[ -]?loop|for\s*循环/i.test(text)) add('使用 for 循环。');
  if (/pseudocode|伪代码/i.test(text)) add('包含伪代码；具体位置和形式以原文为准。');
  const variables = /variables?\s+and\s+constants?|following\s+variables?|指定变量|以下变量/i.test(text) ? paragraphs.map(p => p.match(/^([A-Za-z_$][\w$]*)\s*[:：]/)?.[1]).filter(Boolean) : [];
  if (variables.length) add(`声明变量或常量：${variables.join('、')}。`);
  for (const p of paragraphs) {
    if (constraints.length >= 5) break;
    if (/must|required|必须|需要|不得|至少/i.test(p) && p !== instruction && !/submit|upload|提交|上传|scores?|average|for[ -]?loop|variables?\s+and\s+constants?|following\s+variables?/i.test(p)) add(p);
  }
  const sourceExcerpt = Boolean(objective) && !(threeScores && /average/i.test(text) && /letter grade/i.test(text)) && !(sequence && /largest/i.test(text) && /smallest/i.test(text));
  return { objective: translateText(objective || '暂未提取到任务目标，请查看老师原文。', language), constraints: constraints.slice(0, 5).map(text => translateText(text, language)), method: 'local', sourceExcerpt };
}
