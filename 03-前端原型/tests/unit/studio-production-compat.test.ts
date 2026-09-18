import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildArtifactPlan, artifactPayload, artifactTargetIssues } from '@/server/artifact-plan';
import { inspectProductionReuse } from '@/server/studio-review-requests';
import { StudioEngine, type ModelTransport } from '@/server/studio-models';
import { StudioJobStore } from '@/server/studio-job-store';
import { studioArtifactSchema } from '@/domain/studio';
import { plannedArtifact, reviewBlueprint, reviewAudit, reviewArtifacts, reviewCheckpoint } from '../fixtures/studio-review';
const config={baseUrl:'https://example.invalid/v1',apiKey:'test-m4b-review-fixture',mainModel:'main',reviewA:'review-a',reviewB:'review-b'};
const power=async()=>({assertActive(){},async release(){}});
const stores:StudioJobStore[]=[];const roots:string[]=[];
afterEach(()=>{vi.restoreAllMocks();for(const s of stores.splice(0))s.close();for(const p of roots.splice(0))rmSync(p,{recursive:true,force:true});});
const store=(file=':memory:')=>{const s=new StudioJobStore(file);stores.push(s);return s;};
const file=()=>{const p=mkdtempSync(join(tmpdir(),'m4b-extra-'));roots.push(p);return join(p,'jobs.sqlite');};
const call=vi.fn<ModelTransport>(async(_c,model,instruction,payload,schema)=>schema===studioArtifactSchema?plannedArtifact(payload as Parameters<typeof plannedArtifact>[0]):{...reviewAudit(),summary:JSON.stringify([model,instruction.slice(0,15)])});
async function wait(engine:StudioEngine,id:string){for(let i=0;i<300;i++){const j=engine.get(id);if(j.status!=='running')return j;await new Promise(r=>setImmediate(r));}throw new Error('not settled');}
function engine(s:StudioJobStore,transport:ModelTransport=call){return new StudioEngine(()=>config,transport,Date.now,s,power);}
it('different six reports replay hashes exactly and missing or invalid required cache defeats allCached',async()=>{
 call.mockClear();const s=store();const e=engine(s);const bp=reviewBlueprint(),plan=buildArtifactPlan(bp);const started=await e.start('review',{blueprint:bp},randomUUID());const done=await wait(e,started.jobId);expect(done.status).toBe('completed');expect(call).toHaveBeenCalledTimes(16);
 const snap=s.production.snapshot(started.reviewProgress!.runId!);expect(inspectProductionReuse(plan,snap,bp,config)).toMatchObject({allCached:true,savedUnits:16,totalUnits:16});
 const missing=structuredClone(snap);missing.units=missing.units.filter(u=>u.id!==plan.targets[0].id);expect(inspectProductionReuse(plan,missing,bp,config).allCached).toBe(false);
 const wrong=structuredClone(snap);wrong.units.find(u=>u.id==='mutualB')!.requestHash='0'.repeat(64);expect(inspectProductionReuse(plan,wrong,bp,config).allCached).toBe(false);
 const corrupt=structuredClone(snap);(corrupt.units.find(u=>u.id===plan.targets[0].id)!.value as {sourceIds:string[]}).sourceIds=['bogus'];expect(inspectProductionReuse(plan,corrupt,bp,config).allCached).toBe(false);
 await wait(e,(await e.start('review',{blueprint:bp},randomUUID())).jobId);expect(call).toHaveBeenCalledTimes(16);
});
it('aggregate save failure recovers locally without redoing successful generation',async()=>{
 call.mockClear();const s=store();const original=s.production.save.bind(s.production);let fail=true;vi.spyOn(s.production,'save').mockImplementation((run,unit,...args)=>{if(unit==='artifacts'&&fail){fail=false;throw new Error('synthetic aggregate disk failure');}return original(run,unit,...args);});
 const e=engine(s);const first=await wait(e,(await e.start('review',{blueprint:reviewBlueprint()},randomUUID())).jobId);expect(first.status).toBe('failed');expect(first.reviewProgress!.review.artifacts).toHaveLength(10);expect(call).toHaveBeenCalledTimes(11);
 const done=await wait(e,(await e.start('review',{blueprint:reviewBlueprint()},randomUUID())).jobId);expect(done.status).toBe('completed');expect(call).toHaveBeenCalledTimes(16);expect(s.production.snapshot(first.reviewProgress!.runId!).units.find(u=>u.id==='artifacts')!.callId).toBeNull();
});
it('real old seven-unit database without plans table reads and recovers intact',()=>{
 const path=file();const old=store(path);const id=randomUUID(),checkpoint=reviewCheckpoint();checkpoint.steps.forEach(s=>s.state='pending');checkpoint.review.artifacts=[];checkpoint.review.reports={};
 const run=old.claim({jobId:id,status:'running',phase:'legacy',reviewProgress:checkpoint},'a'.repeat(64),undefined,undefined,'b'.repeat(64)).productionId!;
 old.production.begin(run,'designGate',id,'c'.repeat(64));old.production.save(run,'designGate',id,'c'.repeat(64),reviewAudit());old.production.begin(run,'artifacts',id,'d'.repeat(64));old.production.save(run,'artifacts',id,'d'.repeat(64),{artifacts:reviewArtifacts()});
 stores.splice(stores.indexOf(old),1);old.close();const raw=new DatabaseSync(path);raw.exec('DROP TABLE studio_production_plans');raw.prepare('UPDATE studio_jobs SET lease_until = 0 WHERE id = ?').run(id);raw.close();
 const next=store(path);const view=next.read(id)!.view;expect(view.status).toBe('failed');expect(view.reviewProgress!.review.artifacts).toEqual(reviewArtifacts());expect(view.reviewProgress!.generation).toBeUndefined();expect(next.production.snapshot(run).plan).toBeNull();
 const newid=randomUUID();expect(()=>next.claim({jobId:newid,status:'running',phase:'wrong upgrade'},'e'.repeat(64),undefined,undefined,'b'.repeat(64),buildArtifactPlan(reviewBlueprint()))).toThrow('旧批次');expect(next.read(newid)).toBeNull();
});
it('future public clue cannot be attached to an earlier round public handout',()=>{
 const bp=reviewBlueprint();bp.rounds.push({...bp.rounds[0],id:'R2',name:'终轮'});bp.clues.push({...bp.clues[0],id:'C2',roundId:'R2',content:'终轮才公开的唯一密码'});
 const plan=buildArtifactPlan(bp);const target=plan.targets.find(t=>t.module==='clues'&&t.roundId==='R1')!;const payload=artifactPayload(bp,target);const bad=plannedArtifact(payload);bad.sourceIds.push('C2');bad.content+='。终轮才公开的唯一密码';
 expect(artifactTargetIssues(payload.target,bad).length).toBeGreaterThan(0);
});
it('complete engine must not issue pass for earlier public handout with later clue source',async()=>{
 const bp=reviewBlueprint();bp.rounds.push({...bp.rounds[0],id:'R2',name:'终轮'});bp.clues.push({...bp.clues[0],id:'C2',roundId:'R2',content:'终轮才公开的唯一密码'});const s=store();
 const transport:ModelTransport=async(_c,_m,_i,payload,schema)=>{if(schema!==studioArtifactSchema)return reviewAudit();const artifact=plannedArtifact(payload as Parameters<typeof plannedArtifact>[0]);if(artifact.module==='clues'&&artifact.roundId==='R1'){artifact.sourceIds.push('C2');artifact.content+='。终轮才公开的唯一密码';}return artifact;};
 const e=engine(s,transport);const done=await wait(e,(await e.start('review',{blueprint:bp},randomUUID())).jobId);expect(done.result?.kind==='review'&&done.result.passed).not.toBe(true);
});
it('dynamic dependencies forbid partial aggregate and audit before local aggregate; foreign child ID rejected',()=>{
 const s=store(),jobId=randomUUID(),bp=reviewBlueprint(),plan=buildArtifactPlan(bp),run=s.claim({jobId,status:'running',phase:'test dependencies'},'a'.repeat(64),undefined,undefined,'b'.repeat(64),plan).productionId!;
 const hash=(s:string)=>s.repeat(64);expect(()=>s.production.begin(run,plan.targets[0].id,jobId,hash('c'))).toThrow('前置');s.production.begin(run,'designGate',jobId,hash('d'));s.production.save(run,'designGate',jobId,hash('d'),reviewAudit());
 for(const [i,t] of plan.targets.entries()){if(i===1)expect(()=>s.production.begin(run,'artifacts',jobId,hash('e'))).toThrow('前置');s.production.begin(run,t.id,jobId,hash('c'));s.production.save(run,t.id,jobId,hash('c'),plannedArtifact(artifactPayload(bp,t)));}
 expect(()=>s.production.begin(run,'independentA',jobId,hash('f'))).toThrow('前置');expect(()=>s.production.begin(run,'gen-unknown',jobId,hash('f'))).toThrow('Unknown');s.production.begin(run,'artifacts',jobId,hash('e'));s.production.save(run,'artifacts',jobId,hash('e'),{manifest:'synthetic'});expect(()=>s.production.begin(run,'independentA',jobId,hash('f'))).not.toThrow();
});
