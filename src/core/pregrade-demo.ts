import type { AssignmentSnapshot, CanvasState } from './types';
import type { GradingBasis, GradingHistory, PregradeReport } from './pregrade';
export const DEMO_REFLECTION = 'I heated a beaker of water for two minutes. Its temperature rose from 20°C to 35°C. The heater transferred energy to the water. I repeated the experiment once and observed a similar increase.';
export const DEMO_BASIS: GradingBasis = {source:'canvas',title:'Lab reflection rubric',assignmentPoints:20,useForGrading:true,hidePoints:false,criteria:[
  {id:'observation',label:'Observation',description:'Describe the procedure and record a measurable observation.',points:5,useRange:false,ignore:false,ratings:[{id:'o0',points:0,description:'No observation'},{id:'o3',points:3,description:'Observation without measurement'},{id:'o5',points:5,description:'Procedure and measured observation'}]},
  {id:'explanation',label:'Scientific explanation',description:'Explain the temperature change using energy transfer and particle motion.',points:10,useRange:false,ignore:false,ratings:[{id:'e0',points:0,description:'No explanation'},{id:'e5',points:5,description:'Energy transfer mentioned, particle mechanism incomplete'},{id:'e10',points:10,description:'Energy transfer and particle motion connected accurately'}]},
  {id:'clarity',label:'Clarity',description:'Present a concise, understandable reflection.',points:5,useRange:false,ignore:false,ratings:[{id:'c0',points:0,description:'Not understandable'},{id:'c5',points:5,description:'Clear and concise'}]},
]};
export const DEMO_FEEDBACK:GradingHistory={grades:[{id:'grade:demo-1',attempt:1,score:10,gradedAt:'2026-11-16T16:00:00Z',pointsDeducted:0}],feedback:[{id:'comment:demo-1',text:'Include the measured temperatures, then explain how transferred energy affects particle motion.',createdAt:'2026-11-16T16:00:00Z',attempt:1}],excludedComments:0};
export function pregradeDemoState(revision:number):CanvasState {
  const description='Write a short reflection on heating water. Describe your observation and explain the temperature change. Use the lab reflection rubric.';
  const assignment:AssignmentSnapshot={key:'demo:pregrade',title:'Heating water · Lab reflection',url:'',description,paragraphs:[description],permittedExtensions:[],attempt:'Attempt 2',source:'demo',capturedAt:0,submissionMode:'text',grading:DEMO_BASIS};
  return {assignment,revision,coverage:'complete',warning:'',attachmentSource:'draft',attachments:[],submissionText:DEMO_REFLECTION,historyStatus:'ready',gradingHistory:DEMO_FEEDBACK,history:[{attempt:1,submittedAt:'2026-11-15T16:00:00Z',attachments:[],submissionText:'I heated some water. It became hotter.'}]};
}
export function samplePregrade(language:'en'|'zh-CN'):PregradeReport {
  const en=language==='en',ev=(text:string)=>({fileId:'canvas:text',fileName:en?'Canvas text entry.txt':'Canvas 文字提交.txt',text,line:1});
  return {total:{low:15,high:15,max:20,kind:'assignment'},assessedPoints:20,possiblePoints:20,complete:true,notices:[en?'Synthetic example for the interface. No AI request was made.':'界面合成示例，未调用 AI。'],criteria:[
    {criterionId:'observation',low:5,high:5,reason:en?'The procedure and both measured temperatures are present.':'有实验过程和前后温度数值。',suggestion:'',historyIds:['comment:demo-1'],evidence:[ev('Its temperature rose from 20°C to 35°C.')]},
    {criterionId:'explanation',low:5,high:5,reason:en?'Energy transfer is named, but its connection to particle motion is not explained. This matches the 5-point rubric level.':'提到了能量传递，但未解释粒子运动，对应评分表的 5 分档。',suggestion:en?'Explain the link between transferred energy and particle motion in your own words.':'用自己的话解释能量传递与粒子运动的关系。',historyIds:['comment:demo-1'],evidence:[ev('The heater transferred energy to the water.')]},
    {criterionId:'clarity',low:5,high:5,reason:en?'The reflection is concise and understandable.':'表述简洁、容易理解。',suggestion:'',historyIds:[],evidence:[ev('I heated a beaker of water for two minutes.')]}
  ],feedback:[{feedbackId:'comment:demo-1',status:'partial',reason:en?'Measured temperatures were added. The requested explanation of particle motion is still missing.':'已补充测量温度；老师要求的粒子运动解释仍未体现。',evidence:[ev('Its temperature rose from 20°C to 35°C.'),ev('The heater transferred energy to the water.')]}]};
}
