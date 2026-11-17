import 'dotenv/config';
import { hashPassword } from 'better-auth/crypto';
import { z } from 'zod';
import { db } from '../src/server/db';

// Local administration only. This function is never exposed through an HTTP route.
export async function resetOwnerPassword(email:string,password:string){
  const normalized=z.email().parse(email.trim().toLowerCase());
  if(password.length<12||password.length>128)throw Error('Пароль должен содержать от 12 до 128 символов.');
  const hashed=await hashPassword(password);
  await db.$transaction(async tx=>{
    const owner=await tx.user.findUnique({where:{email:normalized}});
    if(!owner)throw Error('Аккаунт с таким email не найден. Проверь email или создай новый аккаунт.');
    const updated=await tx.account.updateMany({where:{userId:owner.id,providerId:'credential'},data:{password:hashed}});
    if(updated.count!==1)throw Error('Не удалось найти пароль аккаунта. Изменения отменены.');
    await tx.session.deleteMany({where:{userId:owner.id}});
  });
}
