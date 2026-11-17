import { gunzipSync } from 'node:zlib';
import { db } from '../src/server/db';
import { Prisma } from '../src/generated/prisma/client';
import { stateSchema } from '../src/domain/types';
import { z } from 'zod';

// Build-time only. The one-time payload is a sensitive Vercel variable, never a source file.
const date=z.string().datetime().transform(value=>new Date(value));
const payloadSchema=z.object({users:z.array(z.object({
  id:z.string(),name:z.string(),email:z.email(),emailVerified:z.boolean(),image:z.string().nullable(),createdAt:date,updatedAt:date,
  credentials:z.array(z.object({id:z.string(),accountId:z.string(),providerId:z.literal('credential'),userId:z.string(),password:z.string(),createdAt:date,updatedAt:date})),
  workspace:z.object({version:z.number().int(),data:stateSchema}).nullable()
}))});
try{
  if(process.env.FINANCE_INITIAL_DATA){
    const raw=gunzipSync(Buffer.from(process.env.FINANCE_INITIAL_DATA,'base64'),{maxOutputLength:8*1024*1024});
    const payload=payloadSchema.parse(JSON.parse(raw.toString('utf8')));
    if(payload.users.some(user=>user.email==='demo@local.test'||user.credentials.some(a=>a.userId!==user.id)))throw Error('Invalid owner data');
    let imported=0;
    await db.$transaction(async tx=>{
      for(const {credentials,workspace,...user} of payload.users){
        const existing=await tx.user.findFirst({where:{OR:[{id:user.id},{email:user.email}]}});
        if(existing){if(existing.id!==user.id)throw Error('Account conflict');continue;}
        await tx.user.create({data:user});
        for(const credential of credentials)await tx.account.create({data:credential});
        if(workspace)await tx.workspace.create({data:{ownerId:user.id,version:workspace.version,data:workspace.data as Prisma.InputJsonValue}});
        imported++;
      }
    },{timeout:60000});
    console.log(`Personal accounts imported: ${imported}. Existing cloud accounts were preserved.`);
  }else console.log('No initial-data import requested.');
}catch{
  console.error('Initial data import failed. Cloud deployment stopped; local data is unchanged.');
  process.exitCode=1;
}finally{await db.$disconnect();}
