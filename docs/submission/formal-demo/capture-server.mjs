// Actual production client/API. The requester only accounts for real upstream HTTP.
import express from 'express';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createApp } from '../../../server/app.ts';
import { FileModelSettingsStore } from '../../../server/model-settings.ts';
import { AnthropicMessagesVisionAdapter } from '../../../server/anthropic-vision.ts';
import { AnthropicSourceInvestigationDriver } from '../../../server/source-investigation.ts';
import { SOURCE_INVESTIGATION_PROMPT } from '../../../server/source-prompt.ts';
import { HttpBudget } from '../../../scripts/holdout-http.ts';
import { restoreCaptureBudget } from '../code-demo/capture-budget.mjs';

if (process.argv.length !== 3 || process.argv[2] !== '--execute') throw new Error('Use --execute only with the 2026-10-16 recording authorization.');
const evidence = resolve('docs/evidence/formal-demo-2026-10-16-round1');
mkdirSync(evidence, { recursive: true });
const store = new FileModelSettingsStore(join(process.env.LOCALAPPDATA, 'TuZheng/formal-recording-2026-10-16.secret.json'));
const settings = await store.read();
const config = settings.providers.anthropic;
if (settings.activeProvider !== 'anthropic' || config.baseUrl !== 'https://api.deepseek.com/anthropic/v1' || !config.apiKey) throw new Error('Dedicated DeepSeek official configuration is required.');
const safe = value => JSON.parse(JSON.stringify(value).split(config.apiKey).join('[REDACTED]'));
const hash = value => createHash('sha256').update(value).digest('hex');
function synced(path, text, flag = 'w') {
  const fd = openSync(path, flag);
  try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
}
const save = (name, value, flag='w') => synced(join(evidence,name), JSON.stringify(safe(value),null,2)+'\n',flag);
const journal = (name,value) => synced(join(evidence,name),JSON.stringify(safe(value))+'\n','a');
const recordPath = join(evidence,'request-records.json');
if (existsSync(join(evidence,'summary.json')) && JSON.parse(readFileSync(join(evidence,'summary.json'),'utf8')).operationStatus === 'complete') throw new Error('This recording batch is complete; do not reuse its authorization.');
if (!existsSync(join(evidence,'authorization.json'))) save('authorization.json',{
  authorizedOn:'2026-10-16',userAuthorization:'自行灵活判断复用或重新录制；允许使用模型请求，用 DeepSeek 官方，账户接近十元；用户提供了测试用官方密钥。',
  scope:'Silent formal product video; actual production browser paths, not a benchmark.',
  agentSelectedMaxActualHttpRequests:24,userSpecifiedMonetaryCap:null,
  agentSelectedObservedBalanceDrawdownStop:1,agentSelectedBalanceFloor:2,
  balanceGuardLimit:'Balance observations are a stop signal, not a guaranteed per-request monetary cap or an itemized bill.',
  provider:'anthropic',baseUrl:config.baseUrl,model:config.model,createdAt:new Date().toISOString(),
  previousGatewayUnknownRequest:'Unresolved and preserved; this is a separately authorized official-provider recording batch.',
},'wx');
let scenario='setup', balanceRequests=0;
const budget = new HttpBudget({maxRequests:24,timeoutMs:60000,persist:async row=>{
  journal('http-events.jsonl',row);
  synced(join(evidence,'request-records.tmp.json'),JSON.stringify(safe(budget.records),null,2)+'\n');
  renameSync(join(evidence,'request-records.tmp.json'),recordPath);
  save('stop.json',{stopReason:budget.stopReason,recordedRequests:budget.records.length});
}});
if (existsSync(recordPath)) restoreCaptureBudget(budget,JSON.parse(readFileSync(recordPath,'utf8')),existsSync(join(evidence,'stop.json'))?JSON.parse(readFileSync(join(evidence,'stop.json'),'utf8')).stopReason:null);
async function balance(phase) {
  balanceRequests++;
  const reply=await fetch('https://api.deepseek.com/user/balance',{headers:{authorization:`Bearer ${config.apiKey}`},signal:AbortSignal.timeout(20000)});
  if(!reply.ok){budget.halt(`Balance check failed: HTTP ${reply.status}`);throw new Error(budget.stopReason);}
  const body=await reply.json();const item=body.balance_infos?.find(row=>row.currency==='CNY');
  const amount=Number(item?.total_balance);
  if(!Number.isFinite(amount)||!body.is_available){budget.halt('Official balance unavailable.');throw new Error(budget.stopReason);}
  journal('balance-events.jsonl',{time:new Date().toISOString(),phase,totalBalanceCny:amount,isAvailable:body.is_available});
  return amount;
}
const balancePath=join(evidence,'balance-start.json');
const currentBalance=await balance('server-start');
if(!existsSync(balancePath))save('balance-start.json',{totalBalanceCny:currentBalance,observedAt:new Date().toISOString()},'wx');
const startingBalance=JSON.parse(readFileSync(balancePath,'utf8')).totalBalanceCny;
async function requester(body) {
  const available=await balance(`before-${budget.records.length+1}`);
  if(available<2 || startingBalance-available>=1){budget.halt('Agent-selected balance stop reached.');throw new Error(budget.stopReason);}
  try {
    const raw=await budget.send(config,'anthropic',body,{arm:'actual-product',questionId:scenario,phase:'before'});
    if(raw.stop_reason==='max_tokens'){budget.halt('Actual model output truncated; stop new calls.');save('stop.json',{stopReason:budget.stopReason});}
    await balance(`after-${budget.records.length}`);
    return raw;
  } catch(error) {
    const last=budget.records.at(-1);
    if(last?.attempted&&last.httpStatus===null)budget.halt('Request completion unknown; reconcile before further calls.');
    save('stop.json',{stopReason:budget.stopReason});throw error;
  }
}
const actual=createApp({settingsStore:store,
  visionAdapterFactory:()=>new AnthropicMessagesVisionAdapter(config,requester),
  investigationDriverFactory:(_settings,image,caption)=>new AnthropicSourceInvestigationDriver(config,image,caption,SOURCE_INVESTIGATION_PROMPT,requester),
});
const app=express();
app.use(express.json({limit:'32kb'}));
app.post('/capture/scenario',(req,res)=>{if(typeof req.body?.name!=='string'||!/^[a-z0-9-]{1,80}$/.test(req.body.name))return res.status(400).end();scenario=req.body.name;res.json({scenario});});
app.use((req,res,next)=>{if(req.method==='POST'&&/^\/api\/(audit\/(image|check)|source-audit\/)/.test(req.path)){
  const original=res.json.bind(res);res.json=payload=>{journal('product-api.jsonl',{time:new Date().toISOString(),scenario,path:req.path,status:res.statusCode,payload});return original(payload);};
}next();});
const summary=()=>({mode:'actual-product-formal-recording',provider:'anthropic',model:config.model,maxActualHttpRequests:24,
  reservedRequests:budget.records.length,actualHttpRequests:budget.records.filter(row=>row.attempted).length,
  inputTokens:budget.records.every(row=>row.inputTokens!==null)?budget.records.reduce((sum,row)=>sum+row.inputTokens,0):null,
  outputTokens:budget.records.every(row=>row.outputTokens!==null)?budget.records.reduce((sum,row)=>sum+row.outputTokens,0):null,
  failedHttp:budget.records.filter(row=>row.status==='failed').length,stopReason:budget.stopReason,balanceReadRequests:balanceRequests,cost:null,
});
app.get('/capture/summary',(_req,res)=>res.json(summary()));
app.post('/capture/complete',async(_req,res)=>{const finalBalance=await balance('recording-complete');const value={...summary(),operationStatus:'complete',startingBalanceCny:startingBalance,finalBalanceCny:finalBalance,observedBalanceDecreaseCny:Number((startingBalance-finalBalance).toFixed(6)),balanceDecreaseIsNotItemizedBilling:true};save('summary.json',value);budget.halt('Recording batch completed.');res.json(value);});
app.post('/api/settings/test-connection',(_req,res)=>res.status(409).json({error:{code:'CAPTURE_SCOPE',message:'录制仅启用图表读取与来源核验。'}}));
app.use(actual);app.use(express.static(resolve('dist/client')));
app.get(/^(?!\/api\/).*/,(_req,res)=>res.sendFile(resolve('dist/client/index.html')));
save('runtime-provenance.json',{sourceSha:process.env.FORMAL_SOURCE_SHA??null,createdAt:new Date().toISOString(),model:config.model,baseUrl:config.baseUrl,
  files:Object.fromEntries(['dist/client/index.html','web/pages/AuditPage.vue','web/pages/SourceAuditPage.vue','server/app.ts','server/anthropic-vision.ts','server/source-investigation.ts','shared/source-audit.ts'].map(path=>[path,hash(readFileSync(path))])),responseFixtures:false,
});
const server=app.listen(7110,'127.0.0.1',()=>console.log(JSON.stringify({url:'http://127.0.0.1:7110',model:config.model,balanceCny:currentBalance,remainingRequests:24-budget.records.length})));
server.once('error',error=>{console.error(error.code);process.exit(1);});
