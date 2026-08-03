import { LaunchFormValues } from './types';

interface StepTagsDetailsProps {
  values: LaunchFormValues;
  onChange: <K extends keyof LaunchFormValues>(key: K, value: LaunchFormValues[K]) => void;
}

export function StepTagsDetails({ values, onChange }: StepTagsDetailsProps) {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Tags & Details</h2>
        <p className="mt-1 text-sm text-gray-500">Help your team and cost reports identify this workstation.</p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label htmlFor="tagPurpose" className="block text-sm font-medium text-gray-700 mb-1.5">
              Purpose
            </label>
            <input
              id="tagPurpose"
              type="text"
              value={values.tagPurpose}
              onChange={(e) => onChange('tagPurpose', e.target.value)}
              placeholder="e.g. workstation"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-md text-sm"
            />
          </div>
          <div>
            <label htmlFor="tagDepartment" className="block text-sm font-medium text-gray-700 mb-1.5">
              Department
            </label>
            <input
              id="tagDepartment"
              type="text"
              value={values.tagDepartment}
              onChange={(e) => onChange('tagDepartment', e.target.value)}
              placeholder="e.g. se"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-md text-sm"
            />
          </div>
        </div>

        <div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={values.tagLongRunning}
              onChange={(e) => onChange('tagLongRunning', e.target.checked)}
              className="w-4 h-4"
            />
            <span className="text-sm text-gray-700">Long-running instance</span>
          </label>
          <p className="text-xs text-gray-500 mt-1 ml-6">
            Marks this workstation with <code>long_running=true</code> for cost tracking
          </p>
        </div>
      </div>
    </div>
  );
}

export default StepTagsDetails;
