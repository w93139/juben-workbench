import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioJobStore } from '@/server/studio-job-store';
import { StudioBilling, studioConfigFingerprint, studioInputFingerprint } from '@/server/studio-billing';
import { StudioPrices } from '@/server/studio-pricing';
import { StudioEngine, openAITransport } from '@/server/studio-models';
import { previewStudioCost } from '@/server/studio-cost-preview';
import { reviewAudit, reviewArtifacts, reviewBlueprint } from '../fixtures/studio-review';
const config = { baseUrl: 'https://maas-api.antdigital.com/v1', apiKey: 'test-synthetic-fixture-only', mainModel: 'main', reviewA: 'review-a', reviewB: 'review-b' };
const stores: StudioJobStore[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); for (const s of stores.splice(0)) s.close(); });
const power = async () => ({ assertActive() {}, async release() {} });
const input = () => ({ blueprint: reviewBlueprint() });
async function wait(engine: StudioEngine, id: string) { for (let i=0;i<200;i++) { const view=engine.get(id); if(view.status!=='running') return view; await new Promise(resolve=>setImmediate(resolve)); } throw new Error('not settled'); }
function setup(path = ":memory:") {
  const store = new StudioJobStore(path); stores.push(store); store.budget.configure('project-a', 100000, 0);
  const prices = new StudioPrices(vi.fn<typeof fetch>(async()=>Response.json({ success:true, data:{items:['main','review-a','review-b'].map(name=>({name,inPrice:'¥1/M',outPrice:'¥2/M',status:'RELEASED',type:'TEXT_GENERATE',offShelfFlag:0,modelProtocolCompatibility:{openai_chat_completions:true},protocolParameters:[{protocolName:'openai_chat_completions',parameters:{response_format:true}}]}))}})));
  const billing = new StudioBilling(store.budget, prices);
  const engine = new StudioEngine(()=>config,openAITransport,Date.now,store,power,billing);
  const fetcher = vi.fn<typeof fetch>(async(_url, init)=> { const body=JSON.parse(String(init?.body)); const artifact=body.messages[0].content.includes('六类必须齐'); return Response.json({model:body.model,usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200},choices:[{finish_reason:'stop',message:{content:JSON.stringify(artifact?{artifacts:reviewArtifacts()}:reviewAudit())}}]}); }); vi.stubGlobal('fetch',fetcher);
  const preview = (project='project-a') => previewStudioCost(billing,config,project,'review',input(),store.production);
  const start = async (project='project-a')=> {const p=await preview(project); return wait(engine,(await engine.start('review',input(),randomUUID(),{projectId:project,revision:1,previewId:p.previewId})).jobId);};
  return {store,billing,engine,fetcher,preview,start};
}
it('actual transport records all 7 stage call IDs; zero-call reuse and different-project isolation',async()=>{
 const s=setup(); const done=await s.start(); expect(done.status).toBe('completed'); const p=await s.preview(); expect(p).toMatchObject({callsMax:7,checkpoint:{savedUnits:7,interruptedUnits:0}});
 const snap=s.store.production.snapshot(p.checkpoint!.runId!); const calls=s.store.budget.snapshot('project-a')!.calls;
 expect(snap.units.every(u=>u.saved&&calls.some(c=>c.callId===u.callId&&c.state==='settled'))).toBe(true);
 await s.start(); expect(s.fetcher).toHaveBeenCalledTimes(7); s.store.budget.configure('project-b',100000,0); await s.start('project-b'); expect(s.fetcher).toHaveBeenCalledTimes(14);
});
it('attach-call failure happens before any network and releases reserve',async()=>{
 const s=setup(); vi.spyOn(s.store.production,'attachCall').mockImplementationOnce(()=>{throw new Error('synthetic disk failure');});
 const failed=await s.start(); expect(failed.status).toBe('failed'); expect(s.fetcher).not.toHaveBeenCalled(); expect(s.store.budget.snapshot('project-a')).toMatchObject({spentFen:0,reservedFen:0,uncertainCalls:0});
 expect(s.store.budget.snapshot('project-a')!.calls[0].state).toBe('released'); await s.start(); expect(s.fetcher).toHaveBeenCalledTimes(7);
});
it('charged response save failure is advertised as interrupted and retry preserves original charge',async()=>{
 const s=setup(); vi.spyOn(s.store.production,'save').mockImplementationOnce(()=>{throw new Error('synthetic disk failure');});
 const failed=await s.start(); expect(failed.status).toBe('failed'); expect(s.store.budget.snapshot('project-a')!.spentFen).toBe(1); const p=await s.preview();expect(p.checkpoint).toMatchObject({savedUnits:0,interruptedUnits:1});
 expect(s.store.production.snapshot(p.checkpoint!.runId!).units[0]).toMatchObject({saved:false,callId:expect.any(String)});
 await s.start();expect(s.fetcher).toHaveBeenCalledTimes(8);expect(s.store.budget.snapshot('project-a')!.spentFen).toBe(8);
});
it('unknown charge blocks both preview and stale pre-created admission without further calls',async()=>{
 const s=setup(); const old=await s.preview(); s.fetcher.mockImplementationOnce(async()=>Response.json({model:'main',choices:[{finish_reason:'stop',message:{content:JSON.stringify(reviewAudit())}}]}));
 const failed=await s.start();expect(failed.status).toBe('failed');expect(s.store.budget.snapshot('project-a')!.uncertainCalls).toBe(1);
 await expect(s.preview()).rejects.toThrow('待核对');await expect(s.engine.start('review',input(),randomUUID(),{projectId:'project-a',revision:1,previewId:old.previewId})).rejects.toThrow('待核对');expect(s.fetcher).toHaveBeenCalledTimes(1);
});
it('preview from old config-only protocol is rejected before calls',async()=>{
 const s=setup();const fingerprint=studioInputFingerprint('project-a','review',JSON.stringify(input()));const previewId=s.store.budget.preparePreview('project-a',1,fingerprint,studioConfigFingerprint(config));
 await expect(s.engine.start('review',input(),randomUUID(),{projectId:'project-a',revision:1,previewId})).rejects.toThrow('费用预览');expect(s.fetcher).not.toHaveBeenCalled();
});
it('a response failing exact artifact provenance must remain retryable for the unchanged blueprint',async()=>{
 const s=setup();let bad=true;const implementation=s.fetcher.getMockImplementation()!; s.fetcher.mockImplementation(async(...args)=>{
 const body=JSON.parse(String(args[1]?.body));if(bad&&body.messages[0].content.includes('六类必须齐')) { const artifacts=reviewArtifacts();artifacts[0].sourceIds.push('invented-source');return Response.json({model:body.model,usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200},choices:[{finish_reason:'stop',message:{content:JSON.stringify({artifacts})}}]});}return implementation(...args);});
 const failed=await s.start(); expect(failed.status).toBe('failed'); expect(failed.reviewProgress?.review.issues.some(x=>x.includes('来源'))).toBe(true);bad=false;
 const fixed=await s.start();expect(fixed.result?.kind==='review'&&fixed.result.passed).toBe(true);
});
it('a schema-valid invented audit quotation must remain retryable for unchanged blueprint',async()=>{
 const s=setup();const audit=reviewAudit();audit.evidence[0].quote='这不是蓝图里任何一个字段';s.fetcher.mockImplementationOnce(async()=>Response.json({model:'main',usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200},choices:[{finish_reason:'stop',message:{content:JSON.stringify(audit)}}]}));
 const failed=await s.start();expect(failed.status).toBe('failed'); expect(failed.reviewProgress?.review.issues.some(x=>x.includes('引用'))).toBe(true);
 const fixed=await s.start();expect(fixed.result?.kind==='review'&&fixed.result.passed).toBe(true);
});

it('late usage settles money but cannot save a stage or revive an interrupted job',async()=>{
 let now=Date.now();vi.spyOn(Date,'now').mockImplementation(()=>now);const s=setup();let resolve!: (value:Response)=>void;
 s.fetcher.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const p=await s.preview();const first=await s.engine.start('review',input(),randomUUID(),{projectId:'project-a',revision:1,previewId:p.previewId});
 await vi.waitFor(()=>expect(s.fetcher).toHaveBeenCalledTimes(1));now+=16000;expect(s.engine.get(first.jobId).status).toBe('failed');await new Promise(r=>setImmediate(r));expect(s.store.budget.snapshot('project-a')!.uncertainCalls).toBe(1);
 const audit=reviewAudit();audit.summary='late response that must not enter content';resolve(Response.json({model:'main',usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200},choices:[{finish_reason:'stop',message:{content:JSON.stringify(audit)}}]}));
 await vi.waitFor(()=>expect(s.store.budget.snapshot('project-a')!.uncertainCalls).toBe(0));expect(s.engine.get(first.jobId).status).toBe('failed');const nextPreview=await s.preview();expect(nextPreview.checkpoint).toMatchObject({savedUnits:0,interruptedUnits:1});
 const done=await s.start();expect(done.status).toBe('completed');expect(s.fetcher).toHaveBeenCalledTimes(8);if(done.result?.kind!=='review')throw new Error('missing review');expect(done.result.reports.designGate!.summary).not.toContain('late');expect(s.store.budget.snapshot('project-a')!.spentFen).toBe(8);
});

it('file database close/reopen retains stages and money beyond task TTL', async()=>{
 let now=Date.now();vi.spyOn(Date,'now').mockImplementation(()=>now);const root=mkdtempSync(join(tmpdir(),'m4a-extra-db-')),path=join(root,'jobs.sqlite');
 try {
  const s=setup(path);const done=await s.start();const first=await s.preview();const originalRun=first.checkpoint!.runId!;
  stores.splice(stores.indexOf(s.store),1);s.store.close();now+=8*24*3600000;
  const reopened=new StudioJobStore(path,()=>now);stores.push(reopened);const billing=new StudioBilling(reopened.budget,s.billing.prices);const engine=new StudioEngine(()=>config,openAITransport,()=>now,reopened,power,billing);
  expect(reopened.read(done.jobId)).toBeNull();expect(reopened.production.snapshot(originalRun).units.every(u=>u.saved)).toBe(true);expect(reopened.budget.snapshot('project-a')!.spentFen).toBe(7);
  const p=await previewStudioCost(billing,config,'project-a','review',input(),reopened.production);expect(p.checkpoint).toMatchObject({runId:originalRun,savedUnits:7});
  const completed=await wait(engine,(await engine.start('review',input(),randomUUID(),{projectId:'project-a',revision:1,previewId:p.previewId})).jobId);expect(completed.status).toBe('completed');expect(s.fetcher).toHaveBeenCalledTimes(7);expect(reopened.budget.snapshot('project-a')!.spentFen).toBe(7);
  stores.splice(stores.indexOf(reopened),1);reopened.close();
 } finally {rmSync(root,{recursive:true,force:true});}
});

it('valid blocking opinion stays saved and cannot be erased by retrying unchanged input',async()=>{
 const s=setup();const audit={...reviewAudit(),blocking:['角色动机需要作者修改'],contentComplete:false};s.fetcher.mockImplementationOnce(async()=>Response.json({model:'main',usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200},choices:[{finish_reason:'stop',message:{content:JSON.stringify(audit)}}]}));
 const first=await s.start();expect(first.status).toBe('completed');expect(first.result?.kind==='review'&&first.result.passed).toBe(false);const p=await s.preview();expect(p.checkpoint).toMatchObject({savedUnits:1,interruptedUnits:0});const next=await s.start();expect(next.result?.kind==='review'&&next.result.reports.designGate?.blocking).toEqual(audit.blocking);expect(s.fetcher).toHaveBeenCalledTimes(1);
});
it('all saved stages can complete without new charges when the remaining budget is zero',async()=>{
 const s=setup();await s.start();s.store.budget.configure('project-a',7,1);
 const p=await s.preview();expect(p.budget.remainingFen).toBe(0);expect(p.checkpoint?.savedUnits).toBe(7);
 const done=await wait(s.engine,(await s.engine.start('review',input(),randomUUID(),{projectId:'project-a',revision:p.budget.revision,previewId:p.previewId})).jobId);
 expect(done.result?.kind==='review'&&done.result.passed).toBe(true);expect(s.fetcher).toHaveBeenCalledTimes(7);
});
