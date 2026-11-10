import fs from'node:fs';import path from'node:path';import{DatabaseSync}from'node:sqlite';
const base='D:/movieAgent/spec/002-project-subprojects/verification/live-20261031',s=JSON.parse(fs.readFileSync(base+'/state.json','utf8')),db=new DatabaseSync(s.libraryRoot+'/library.sqlite',{readOnly:true});
const row=db.prepare('SELECT view_json FROM task_attempt WHERE task_id=?').get(s.liveLong.completion.taskId),task=JSON.parse(row.view_json),blob=db.prepare('SELECT b.* FROM artifact a JOIN blob_object b USING(object_id) WHERE a.id=?').get(task.artifactRef.artifactId);
const bytes=fs.readFileSync(path.join(s.libraryRoot,blob.storage_key));fs.writeFileSync(base+'/long-request/real-memory-response.txt',bytes);
console.log(JSON.stringify({taskId:task.taskId,state:task.state,artifactRef:task.artifactRef,hash:blob.hash,byteLength:bytes.length,text:bytes.toString('utf8')},null,2));db.close();
