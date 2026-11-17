import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { createAuth } from "./owner-auth";
import { db } from "../src/server/db";
import { resetOwnerPassword } from './reset-password';
let muted = false;
const output = new Writable({
  write(chunk, _encoding, callback) {
    if (!muted) process.stdout.write(chunk);
    callback();
  },
});
const rl = createInterface({ input: process.stdin, output, terminal: true });
try {
  const reset=process.argv.includes('--reset-password');
  const email = await rl.question("Email: "),
    name = reset?'':await rl.question("Имя: ");
  process.stdout.write("Пароль (минимум 12 символов, ввод скрыт): ");
  muted = true;
  const password = await rl.question("");
  muted = false;
  process.stdout.write("\n");
  if(reset){
    process.stdout.write('Повтори новый пароль (ввод скрыт): ');muted=true;
    const confirmation=await rl.question('');muted=false;process.stdout.write('\n');
    if(password!==confirmation)throw Error('Пароли не совпадают. Запусти смену пароля ещё раз.');
    await resetOwnerPassword(email,password);
    console.log('Пароль изменён. Данные сохранены. Войди в приложение с новым паролем.');
  }else{
    await createAuth().api.signUpEmail({ body: { email, name, password } });
    console.log("Личный аккаунт создан. Войди в приложение.");
  }
} catch(error){
  muted=false;console.error('\n'+(error instanceof Error?error.message:'Не удалось изменить аккаунт.'));
  process.exitCode=1;
} finally {
  rl.close();
  await db.$disconnect();
}
