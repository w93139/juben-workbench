import { expect, it } from "vitest";
import { buildArtifactPlan, artifactPayload, artifactTargetIssues } from "@/server/artifact-plan";
import { reviewBlueprint, plannedArtifact } from "../fixtures/studio-review";
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
 const target=artifactPayload(bp,plan.targets.find(t=>t.module==='updates'&&t.characterId==='A'&&t.roundId==='R1')!);const result=plannedArtifact(target);expect(artifactTargetIssues(target.target,result)).toEqual([]);result.sourceIds=result.sourceIds.filter(id=>id!=='C1');expect(artifactTargetIssues(target.target,result).join()).toContain('来源关联');
});
it("同名跨章节编号拒绝，不能以模糊ID伪造来源覆盖",()=>{const bp=reviewBlueprint();bp.events[0].id=bp.characters[0].id;expect(()=>buildArtifactPlan(bp)).toThrow('重复编号');});
it("公共线索按轮发放：开场与早轮不能带入未来线索，同轮公共包不重复其他轮，角色更新可回顾已公开线索",()=>{
 const bp=reviewBlueprint();bp.rounds.push({...bp.rounds[0],id:'R2'});bp.clues.push({...bp.clues[0],id:'C2',roundId:'R2',content:'第二轮才允许公开'});const plan=buildArtifactPlan(bp);
 for(const target of plan.targets){const payload=artifactPayload(bp,target);if(target.audience==='host')continue;
 const allowed=payload.target.allowedSourceIds;expect(allowed.includes('C2')).toBe(target.roundId==='R2');if(target.module==='character'||target.module==='private')expect(allowed.includes('C1')).toBe(false);if(target.module==='clues'&&target.roundId==='R2')expect(allowed.includes('C1')).toBe(false);if(target.module==='updates'&&target.roundId==='R2')expect(allowed.includes('C1')).toBe(true);
 if(target.roundId==='R1'){const artifact=plannedArtifact(payload);artifact.sourceIds.push('C2');expect(artifactTargetIssues(payload.target,artifact).join()).toContain('线索发放越界');}
 }
});
