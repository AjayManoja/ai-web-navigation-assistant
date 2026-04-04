function highlightCurrentStep(){

const step=currentPlan.phases[currentPhase].steps[currentStep];

console.log("Current step:",step);

const element=findBestInput(step);

if(!element) return;

element.style.boxShadow="0 0 0 4px red";

element.scrollIntoView({
behavior:"smooth",
block:"center"
});

element.focus();

}