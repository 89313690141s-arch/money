import 'dotenv/config';
import { it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { verifyPassword } from 'better-auth/crypto';
import { createAuth } from '../../scripts/owner-auth';
import { resetOwnerPassword } from '../../scripts/reset-password';
import { db } from '../../src/server/db';
it('смена пароля сохраняет бюджет и отзывает прежние сессии',async()=>{
  const email=`reset-${randomUUID()}@example.test`,old=randomUUID()+randomUUID(),next=randomUUID()+randomUUID();
  const result=await createAuth().api.signUpEmail({body:{email,password:old,name:'Тест восстановления'}});
  try{
    await db.workspace.create({data:{ownerId:result.user.id,data:{marker:'keep-finances'}}});
    await db.session.create({data:{id:randomUUID(),token:randomUUID(),userId:result.user.id,expiresAt:new Date(Date.now()+86400000)}});
    await expect(resetOwnerPassword(email,'short')).rejects.toThrow();
    await resetOwnerPassword(email.toUpperCase(),next);
    const account=await db.account.findFirstOrThrow({where:{userId:result.user.id,providerId:'credential'}});
    expect(await verifyPassword({hash:account.password!,password:next})).toBe(true);
    expect(await verifyPassword({hash:account.password!,password:old})).toBe(false);
    expect((await db.workspace.findUniqueOrThrow({where:{ownerId:result.user.id}})).data).toEqual({marker:'keep-finances'});
    expect(await db.session.count({where:{userId:result.user.id}})).toBe(0);
  }finally{await db.user.delete({where:{id:result.user.id}});await db.$disconnect();}
});
