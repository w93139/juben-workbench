import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { buildArtifactPlan, artifactPayload, artifactInstructions, artifactTargetIssues } from "@/server/artifact-plan";
import { StudioEngine, type ModelTransport } from "@/server/studio-models";
import { StudioJobStore } from "@/server/studio-job-store";
import { reviewBlueprint, reviewAudit, plannedArtifact } from "../fixtures/studio-review";
import { studioArtifactSchema } from "@/domain/studio";
const config = { baseUrl: "https://example.invalid/v1", apiKey: "test-plan-fixture-only", mainModel: "main", reviewA: "review-a", reviewB: "review-b" };
const power = async () => ({ assertActive() {}, async release() {} });
const stores: StudioJobStore[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const store of stores.splice(0)) store.close(); });
async function wait(engine: StudioEngine, id: string) { for (let i=0;i<1000;i++) {const v=engine.get(id); if(v.status!=="running") return v; await new Promise(resolve=>setImmediate(resolve));} throw new Error("not settled"); }
function sized(rounds: number, endings: number) { const bp=reviewBlueprint(); bp.characters.push({...bp.characters[0],id:"C",name:"第三角色"});bp.rounds=Array.from({length:rounds},(_,i)=>({...bp.rounds[0],id:`R${i+1}`}));bp.endings=Array.from({length:endings},(_,i)=>({...bp.endings[0],id:`END${i+1}`}));return bp; }
it("两角色一轮一终局精确10份；三角色两轮两终局19份，数组轮次顺序与稳定ID保留",()=>{
 const bp=reviewBlueprint(), plan=buildArtifactPlan(bp);expect(plan.targets).toHaveLength(10);expect(plan.targets.filter(t=>t.module==='host')).toHaveLength(2);expect(new Set(plan.targets.map(t=>t.id)).size).toBe(10);
 const larger=sized(2,2); larger.rounds.reverse();const p=buildArtifactPlan(larger);expect(p.targets).toHaveLength(19);expect(p.targets.filter(t=>t.characterId==='A'&&t.module==='updates').map(t=>t.roundId)).toEqual(['R2','R1']);
 larger.characters.reverse();expect(new Set(buildArtifactPlan(larger).targets.map(t=>t.id))).toEqual(new Set(p.targets.map(t=>t.id)));
});
it("240份允许，241份拒绝而不截断；每单元必需来源200允许、201拒绝",()=>{
 expect(buildArtifactPlan(sized(46,3)).targets).toHaveLength(240);expect(()=>buildArtifactPlan(sized(46,4))).toThrow('241');
 const bp=reviewBlueprint();bp.knowledge=Array.from({length:198},(_,i)=>({...bp.knowledge[0],id:`K${i}`,characterId:'A'}));expect(buildArtifactPlan(bp).targets.find(t=>t.module==='updates'&&t.characterId==='A')!.requiredSourceIds).toHaveLength(200);
 bp.knowledge.push({...bp.knowledge[0],id:'Kextra'});expect(()=>buildArtifactPlan(bp)).toThrow('200');
});
it("全私人线索仍有公共发放说明单元，来源只允许指定角色指定轮次，条件与五种知情状态原样传入",()=>{
 const bp=reviewBlueprint();bp.clues[0].characterIds=['A'];bp.clues[0].access='先支付成本再领取';bp.clues[0].cost=2;bp.rounds.push({...bp.rounds[0],id:'R2'});
 bp.knowledge=['known','partial','hidden','false','unknown'].map((state,i)=>({...bp.knowledge[0],id:`K${i}`,characterId:'A',state:state as typeof bp.knowledge[number]['state']}));
 const plan=buildArtifactPlan(bp);for(const target of plan.targets){const payload=artifactPayload(bp,target);expect(payload.blueprint).toBe(bp);const allows=target.audience==='host'||target.module==='updates'&&target.characterId==='A'&&target.roundId==='R1';expect(payload.target.allowedSourceIds.includes('C1')).toBe(allows);if(target.module==='clues')expect(target.requiredSourceIds).toEqual([target.roundId]);}
 expect(artifactInstructions).toContain('hidden知道但隐瞒');expect(artifactInstructions).toContain('false保留角色的错误认识');expect(artifactInstructions).toContain('unknown不得透露');expect(artifactInstructions).toContain('未达条件不发放');
 const target=artifactPayload(bp,plan.targets.find(t=>t.module==='updates'&&t.characterId==='A'&&t.roundId==='R1')!);const result=plannedArtifact(target);expect(artifactTargetIssues(target.target,result)).toEqual([]);result.sourceIds=result.sourceIds.filter(id=>id!=='C1');expect(artifactTargetIssues(target.target,result).join()).toContain('来源关联');
});
it("同名跨章节编号拒绝，不能以模糊ID伪造来源覆盖",()=>{const bp=reviewBlueprint();bp.events[0].id=bp.characters[0].id;expect(()=>buildArtifactPlan(bp)).toThrow('重复编号');});
it("蓝图本身不足600KB但目标使请求超限，开始前零模型调用",async()=>{
 const bp=reviewBlueprint();bp.events=Array.from({length:50},(_,i)=>({...bp.events[0],id:`event-${i}`,action:'x'.repeat(11000)}));
 const other=Buffer.byteLength(JSON.stringify({blueprint:bp}));bp.truth='x'.repeat(600000-other-10); // Test engine parses length, so distribute the filler instead.
 const filler=bp.truth.length;bp.truth='truth';let remaining=filler-5;for(const row of bp.events){const add=Math.min(12000-row.action.length,remaining);row.action+='x'.repeat(add);remaining-=add;if(!remaining)break;}
 const inputBytes=Buffer.byteLength(JSON.stringify({blueprint:bp}));expect(inputBytes).toBeLessThan(600000);expect(inputBytes).toBeGreaterThan(598000);
 const call=vi.fn<ModelTransport>(async()=>reviewAudit());const engine=new StudioEngine(()=>config,call,Date.now,undefined,power);
 await expect(engine.start('review',{blueprint:bp})).rejects.toThrow('600KB');expect(call).not.toHaveBeenCalled();
});
it("第4份正文失败后已保存3份，重启只补缺项，聚合不产生模型调用",async()=>{
 const store=new StudioJobStore(':memory:');stores.push(store);let fail=true,n=0;
 const call=vi.fn<ModelTransport>(async(_c,_m,_i,payload,schema)=>{if(schema===studioArtifactSchema){n++;if(fail&&n===4)throw new Error('synthetic nth failure');return plannedArtifact(payload as Parameters<typeof plannedArtifact>[0]);}return reviewAudit();});
 const a=new StudioEngine(()=>config,call,Date.now,store,power);const first=await wait(a,(await a.start('review',{blueprint:reviewBlueprint()},randomUUID())).jobId);
 expect(first.status).toBe('failed');expect(first.reviewProgress?.review.artifacts).toHaveLength(3);expect(first.reviewProgress?.generation?.units.filter(u=>u.state==='saved')).toHaveLength(3);
 fail=false;const b=new StudioEngine(()=>config,call,Date.now,store,power);const done=await wait(b,(await b.start('review',{blueprint:reviewBlueprint()},randomUUID())).jobId);
 expect(done.result?.kind==='review'&&done.result.passed).toBe(true);expect(call).toHaveBeenCalledTimes(17);const snapshot=store.production.snapshot(first.reviewProgress!.runId!);expect(snapshot.units).toHaveLength(17);const aggregate=snapshot.units.find(u=>u.id==='artifacts')!;expect(aggregate.callId).toBeNull();expect(JSON.stringify(aggregate.value)).not.toContain('自造正文');
});
it("审查快照超限仍保留全部长正文，继续不重新收费生成也不截断",async()=>{
 const store=new StudioJobStore(':memory:');stores.push(store);
 const call=vi.fn<ModelTransport>(async(_c,_m,_i,payload,schema)=>schema===studioArtifactSchema?{...plannedArtifact(payload as Parameters<typeof plannedArtifact>[0]),content:'长正文'.repeat(25000)}:reviewAudit());
 const engine=new StudioEngine(()=>config,call,Date.now,store,power);const first=await wait(engine,(await engine.start('review',{blueprint:reviewBlueprint()},randomUUID())).jobId);
 expect(first.error?.code).toBe('CONTEXT_TOO_LARGE');expect(first.reviewProgress?.review.artifacts).toHaveLength(10);expect(first.reviewProgress?.review.artifacts.every(a=>a.content.length===75000)).toBe(true);expect(call).toHaveBeenCalledTimes(11);
 const second=await wait(engine,(await engine.start('review',{blueprint:reviewBlueprint()},randomUUID())).jobId);expect(second.error?.code).toBe('CONTEXT_TOO_LARGE');expect(call).toHaveBeenCalledTimes(11);
});
it("未付费前同时拒绝超限计划与目标错配；模型来源不能由程序自动补齐",async()=>{
 const call=vi.fn<ModelTransport>(async()=>reviewAudit());const engine=new StudioEngine(()=>config,call,Date.now,undefined,power);
 await expect(engine.start('review',{blueprint:sized(46,4)})).rejects.toThrow('241');expect(call).not.toHaveBeenCalled();
 const bp=reviewBlueprint(),target=artifactPayload(bp,buildArtifactPlan(bp).targets[0]);const artifact=plannedArtifact(target);artifact.characterId='B';artifact.sourceIds=[];
 expect(artifactTargetIssues(target.target,artifact)).toEqual(expect.arrayContaining([expect.stringContaining('characterId'),expect.stringContaining('来源关联')]));expect(artifact.sourceIds).toEqual([]);
});
it("公共线索按轮发放：开场与早轮不能带入未来线索，同轮公共包不重复其他轮，角色更新可回顾已公开线索",()=>{
 const bp=reviewBlueprint();bp.rounds.push({...bp.rounds[0],id:'R2'});bp.clues.push({...bp.clues[0],id:'C2',roundId:'R2',content:'第二轮才允许公开'});const plan=buildArtifactPlan(bp);
 for(const target of plan.targets){const payload=artifactPayload(bp,target);if(target.audience==='host')continue;
 const allowed=payload.target.allowedSourceIds;expect(allowed.includes('C2')).toBe(target.roundId==='R2');if(target.module==='character'||target.module==='private')expect(allowed.includes('C1')).toBe(false);if(target.module==='clues'&&target.roundId==='R2')expect(allowed.includes('C1')).toBe(false);if(target.module==='updates'&&target.roundId==='R2')expect(allowed.includes('C1')).toBe(true);
 if(target.roundId==='R1'){const artifact=plannedArtifact(payload);artifact.sourceIds.push('C2');expect(artifactTargetIssues(payload.target,artifact).join()).toContain('线索发放越界');}
 }
});
