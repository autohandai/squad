// Test input, never imported by the product or copied to a desktop runtime.
export function memberFixture(overrides = {}) {
  return { id:'asq_fixture',name:'Fixture teammate',role:'Engineer',employeeType:'full-stack-developer',status:'online',description:'Disposable regression member.',instructions:'Work only inside the test fixture.',workspace:'',projects:[],skills:[],memory:[],harness:{id:'autohand'},launch:{mode:'prompt',policy:'yes',model:'',dryRun:false},stats:{activeDays:0,automations:0,tasks:0,projects:0},...overrides };
}
