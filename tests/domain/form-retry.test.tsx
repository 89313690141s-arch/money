import { afterEach, describe, expect, it, vi } from "vitest";
import type { Command } from "../../src/domain/commands";
import { applyCommand } from "../../src/domain/commands";
import { emptyState } from "../../src/domain/types";

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[] }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values))
      hooks.values[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value; }];
  },
}));
import { OperationForm,AccountForm,DebtForm } from "../../src/components/Forms";

afterEach(() => { vi.unstubAllGlobals(); hooks.values = []; });

describe("Повтор отправки открытой формы", () => {
  it.each(['account','debt'] as const)('не дублирует создание %s после потери ответа',async(kind)=>{
    let state=emptyState();const fields=new FormData();
    for(const [key,value] of Object.entries({name:'Проверка',kind:'debit',opening:'1000',openingDate:'2026-10-31',verifiedDate:'2026-11-17',payment:'100',dueDate:'2026-11-20',minimum:'0',minimumDate:'2026-11-20',graceAmount:'0',graceDate:'2026-11-20',priority:'1',rate:'22',schedule:''}))fields.set(key,value);
    vi.stubGlobal('FormData',class{constructor(){return fields;}});
    const sent:Command[]=[];const save=async(command:Command)=>{sent.push(command);state=applyCommand(state,command);return sent.length===3;};
    for(let i=0;i<3;i++){hooks.cursor=0;const props={s:state,save,close:vi.fn()};const form=kind==='account'?AccountForm(props):DebtForm(props);await form.props.onSubmit({preventDefault(){},currentTarget:{}});}
    expect(sent).toHaveLength(3);expect(sent[1]).toEqual(sent[0]);expect(sent[2]).toEqual(sent[0]);expect(kind==='account'?state.accounts:state.debts).toHaveLength(1);
  });
  it("сохраняет идентичность при потерянном ответе и обновлении версии", async () => {
    let state = emptyState();
    state.accounts = [{ id: "cash", name: "Счёт", kind: "debit", opening: "100000",
      openingDate: "2026-10-31", verifiedDate: "2026-11-17" }];
    const fields = new FormData();
    for (const [key, value] of Object.entries({ amount: "100", date: "2026-11-17",
      accountId: "cash", description: "Покупка", planItemId: "" })) fields.set(key, value);
    vi.stubGlobal("FormData", class { constructor() { return fields; } });
    const commands: Command[] = [];
    const save = vi.fn(async (command: Command) => {
      commands.push(command);
      // The server committed each request; the client missed the first response
      // and then refreshed its version following the conflict response.
      state = applyCommand(state, command);
      return commands.length === 3;
    });
    const close = vi.fn();
    for (let attempt = 0; attempt < 3; attempt++) {
      hooks.cursor = 0;
      const form = OperationForm({ s: state, save, close });
      await form.props.onSubmit({ preventDefault() {}, currentTarget: {} });
    }
    expect(commands[1]).toEqual(commands[0]);
    expect(commands[2]).toEqual(commands[0]);
    expect(state.operations).toHaveLength(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
