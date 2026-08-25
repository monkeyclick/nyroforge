import { CheckIcon } from '@heroicons/react/24/solid';

interface WizardStepperProps {
  steps: string[];
  currentStep: number;
}

export function WizardStepper({ steps, currentStep }: WizardStepperProps) {
  return (
    <ol className="flex items-center w-full mb-10" aria-label="Launch progress">
      {steps.map((label, index) => {
        const isComplete = index < currentStep;
        const isCurrent = index === currentStep;
        const isLast = index === steps.length - 1;

        return (
          <li key={label} className={`flex items-center ${isLast ? '' : 'flex-1'}`}>
            <div className="flex flex-col items-center">
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                  isComplete
                    ? 'bg-blue-600 text-white'
                    : isCurrent
                    ? 'bg-blue-600 text-white ring-4 ring-blue-100'
                    : 'bg-gray-100 text-gray-500 border border-gray-300'
                }`}
                aria-current={isCurrent ? 'step' : undefined}
              >
                {isComplete ? <CheckIcon className="h-5 w-5" /> : index + 1}
              </div>
              <span
                className={`mt-2 text-xs font-medium text-center whitespace-nowrap ${
                  isCurrent ? 'text-gray-900' : 'text-gray-500'
                }`}
              >
                {label}
              </span>
            </div>
            {!isLast && (
              <div className={`mx-3 h-0.5 flex-1 ${isComplete ? 'bg-blue-600' : 'bg-gray-200'}`} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export default WizardStepper;
