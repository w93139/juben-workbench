import { describe, expect, it } from "vitest";
import { walkDroppedEntries, visibleFiles, type DropEntry } from "@/services/folder-drop";
function file(name: string): DropEntry { return { name, isFile:true,isDirectory:false,file:resolve=>resolve(new File(["自有测试"],name)) }; }
function folder(name: string, batches: DropEntry[][]): DropEntry { return { name,isFile:false,isDirectory:true,createReader:()=>{let i=0;return {readEntries:resolve=>resolve(batches[i++] ?? [])};} }; }
describe("拖入文件夹",()=>{
  it("重复读取所有批次，保留子目录路径并过滤系统文件",async()=>{
    const first=Array.from({length:100},(_,i)=>file(`${i}.txt`));
    const result=await walkDroppedEntries([folder("原剧本",[first,[file("最后一页.txt"),file(".DS_Store"),folder("角色",[[file("甲.txt")]])]])]);
    expect(result).toHaveLength(102);expect(result.at(-1)?.webkitRelativePath).toBe("原剧本/角色/甲.txt");expect(await result[0].text()).toBe("自有测试");
  });
  it("空目录、读取失败和超量均拒绝整批，不返回部分文件",async()=>{
    await expect(walkDroppedEntries([folder("空",[])])).rejects.toThrow("没有可读取");
    await expect(walkDroppedEntries([file("a"),file("b")],1)).rejects.toThrow("最多读取1");
    await expect(walkDroppedEntries([{name:"坏文件",isFile:true,isDirectory:false,file:(_s,f)=>f(new DOMException("拒绝读取"))}])).rejects.toThrow("拒绝读取");
    expect(visibleFiles([new File(["x"],".DS_Store"),new File(["x"],"角色.txt")]).map(f=>f.name)).toEqual(["角色.txt"]);
  });
});
