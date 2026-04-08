import React, { useState } from 'react';
import { DynamicRule, RuleCondition, EnhancedUser } from '@/types/auth';
import { apiClient } from '@/services/api';

interface DynamicRuleBuilderProps {
  rule?: DynamicRule;
  onSave: (rule: DynamicRule) => void;
  onCancel: () => void;
  groupId?: string;
}

type ConditionOperator = 'equals' | 'notEquals' | 'contains' | 'startsWith' | 'endsWith' |
                          'greaterThan' | 'lessThan' | 'in' | 'notIn' | 'exists';

const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  equals: 'Equals',
  notEquals: 'Not Equals',
  contains: 'Contains',
  startsWith: 'Starts With',
  endsWith: 'Ends With',
  greaterThan: 'Greater Than',
  lessThan: 'Less Than',
  in: 'In List',
  notIn: 'Not In List',
  exists: 'Exists'
};

const COMMON_FIELDS = [
  { value: 'email', label: 'Email', type: 'string' },
  { value: 'name', label: 'Name', type: 'string' },
  { value: 'department', label: 'Department', type: 'string' },
  { value: 'level', label: 'Level', type: 'string' },
  { value: 'status', label: 'Status', type: 'string' },
  { value: 'roleId', label: 'Role ID', type: 'string' }
];

const OPERATORS_BY_TYPE: Record<string, ConditionOperator[]> = {
  string: ['equals', 'notEquals', 'contains', 'startsWith', 'endsWith', 'in', 'notIn', 'exists'],
  number: ['equals', 'notEquals', 'greaterThan', 'lessThan', 'in', 'notIn', 'exists']
};

export const DynamicRuleBuilder: React.FC<DynamicRuleBuilderProps> = ({
  rule: initialRule,
  onSave,
  onCancel,
  groupId
}) => {
  const [ruleName, setRuleName] = useState(initialRule?.name || '');
  const [ruleDescription, setRuleDescription] = useState(initialRule?.description || '');
  const [priority, setPriority] = useState(initialRule?.priority || 1);
  const [enabled, setEnabled] = useState(initialRule?.enabled !== false);
  const [logicalOperator, setLogicalOperator] = useState<'AND' | 'OR'>(initialRule?.logicalOperator || 'AND');
  const [conditions, setConditions] = useState<RuleCondition[]>(
    initialRule?.conditions || [{
      field: 'email',
      operator: 'contains',
      value: ''
    }]
  );

  const [testResults, setTestResults] = useState<{
    testing: boolean;
    matchedUsers?: number;
    error?: string;
  }>({ testing: false });

  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const addCondition = () => {
    setConditions([...conditions, {
      field: 'email',
      operator: 'contains',
      value: ''
    }]);
  };

  const removeCondition = (index: number) => {
    if (conditions.length > 1) {
      setConditions(conditions.filter((_, i) => i !== index));
    }
  };

  const updateCondition = (index: number, updates: Partial<RuleCondition>) => {
    const newConditions = [...conditions];
    newConditions[index] = { ...newConditions[index], ...updates };
    setConditions(newConditions);
  };

  const getOperatorsForField = (field: string): ConditionOperator[] => {
    const fieldConfig = COMMON_FIELDS.find(f => f.value === field);
    const fieldType = fieldConfig?.type || 'string';
    return OPERATORS_BY_TYPE[fieldType] || OPERATORS_BY_TYPE.string;
  };

  const validateRule = (): string[] => {
    const errors: string[] = [];
    if (!ruleName.trim()) errors.push('Rule name is required');
    if (conditions.length === 0) errors.push('At least one condition is required');
    
    conditions.forEach((condition, index) => {
      if (!condition.field) errors.push(`Condition ${index + 1}: Field is required`);
      if (!condition.operator) errors.push(`Condition ${index + 1}: Operator is required`);
      if (condition.operator !== 'exists' && !condition.value) {
        errors.push(`Condition ${index + 1}: Value is required`);
      }
    });
    return errors;
  };

  const handleSave = () => {
    const errors = validateRule();
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    const rule: DynamicRule = {
      id: initialRule?.id || `rule_${Date.now()}`,
      name: ruleName,
      description: ruleDescription,
      conditions,
      priority,
      enabled,
      logicalOperator
    };

    onSave(rule);
  };

  const testRule = async () => {
    const errors = validateRule();
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    if (!groupId) {
      setTestResults({ testing: false, error: 'Group ID required for testing' });
      return;
    }

    setTestResults({ testing: true });
    setValidationErrors([]);

    try {
      const result = await apiClient.evaluateGroupRules(groupId);
      setTestResults({
        testing: false,
        matchedUsers: result.count
      });
    } catch (error: any) {
      setTestResults({
        testing: false,
        error: error.message || 'Failed to test rule'
      });
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold mb-6">
        {initialRule ? 'Edit Dynamic Rule' : 'Create Dynamic Rule'}
      </h2>

      {validationErrors.length > 0 && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded">
          <p className="font-semibold text-red-800 mb-2">Validation Errors:</p>
          <ul className="list-disc list-inside text-red-700">
            {validationErrors.map((error, i) => (
              <li key={i}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Rule Name *
          </label>
          <input
            type="text"
            value={ruleName}
            onChange={(e) => setRuleName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g., Senior Engineers"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Description
          </label>
          <textarea
            value={ruleDescription}
            onChange={(e) => setRuleDescription(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={2}
            placeholder="Describe what this rule does..."
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Priority
            </label>
            <input
              type="number"
              value={priority}
              onChange={(e) => setPriority(parseInt(e.target.value) || 1)}
              min={1}
              max={100}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Combine Conditions With
            </label>
            <select
              value={logicalOperator}
              onChange={(e) => setLogicalOperator(e.target.value as 'AND' | 'OR')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="AND">AND (all must match)</option>
              <option value="OR">OR (any can match)</option>
            </select>
          </div>
        </div>

        <div className="flex items-center">
          <input
            type="checkbox"
            id="enabled"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
          />
          <label htmlFor="enabled" className="ml-2 block text-sm text-gray-900">
            Rule Enabled
          </label>
        </div>

        <div>
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">Conditions</h3>
            <button
              onClick={addCondition}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              + Add Condition
            </button>
          </div>

          <div className="space-y-4">
            {conditions.map((condition, index) => (
              <div key={index} className="p-4 border border-gray-200 rounded-lg bg-gray-50">
                <div className="grid grid-cols-12 gap-3">
                  <div className="col-span-3">
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Field
                    </label>
                    <select
                      value={condition.field}
                      onChange={(e) => updateCondition(index, { field: e.target.value })}
                      className="w-full px-2 py-2 border border-gray-300 rounded text-sm"
                    >
                      {COMMON_FIELDS.map(field => (
                        <option key={field.value} value={field.value}>
                          {field.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="col-span-3">
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Operator
                    </label>
                    <select
                      value={condition.operator}
                      onChange={(e) => updateCondition(index, { operator: e.target.value as ConditionOperator })}
                      className="w-full px-2 py-2 border border-gray-300 rounded text-sm"
                    >
                      {getOperatorsForField(condition.field).map(op => (
                        <option key={op} value={op}>
                          {OPERATOR_LABELS[op]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="col-span-4">
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Value
                    </label>
                    <input
                      type="text"
                      value={condition.value || ''}
                      onChange={(e) => updateCondition(index, { value: e.target.value })}
                      disabled={condition.operator === 'exists'}
                      className="w-full px-2 py-2 border border-gray-300 rounded text-sm disabled:bg-gray-100"
                      placeholder={condition.operator === 'exists' ? 'N/A' : 'Enter value...'}
                    />
                  </div>

                  <div className="col-span-1 flex items-end">
                    {conditions.length > 1 && (
                      <button
                        onClick={() => removeCondition(index)}
                        className="px-3 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                        title="Remove condition"
                      >
                        ×
                      </button>
                    )}
                  </div>

                </div>
              </div>
            ))}
          </div>
        </div>

        {groupId && (
          <div className="border-t pt-4">
            <button
              onClick={testRule}
              disabled={testResults.testing}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400"
            >
              {testResults.testing ? 'Testing...' : 'Test Rule'}
            </button>

            {testResults.matchedUsers !== undefined && (
              <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded">
                <p className="text-green-800">
                  ✓ Rule would match <strong>{testResults.matchedUsers}</strong> user(s)
                </p>
              </div>
            )}

            {testResults.error && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded">
                <p className="text-red-800">✗ {testResults.error}</p>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end space-x-3 pt-4 border-t">
          <button
            onClick={onCancel}
            className="px-6 py-2 border border-gray-300 rounded hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Save Rule
          </button>
        </div>
      </div>
    </div>
  );
};