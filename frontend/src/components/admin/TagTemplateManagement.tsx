import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../services/api';
import { TagTemplate, TagField } from '../../types';

const CATEGORY_OPTIONS = ['security', 'cost', 'compliance', 'environment', 'project', 'custom'];

const emptyField = (): TagField => ({
  key: '',
  label: '',
  description: '',
  required: false,
  allowedValues: [],
  defaultValue: '',
});

// ─── Field Editor ────────────────────────────────────────────────────────────

interface FieldEditorProps {
  field: TagField;
  index: number;
  onChange: (index: number, updated: TagField) => void;
  onRemove: (index: number) => void;
}

const FieldEditor: React.FC<FieldEditorProps> = ({ field, index, onChange, onRemove }) => {
  const [allowedInput, setAllowedInput] = useState('');

  const update = (patch: Partial<TagField>) => onChange(index, { ...field, ...patch });

  const addAllowed = () => {
    const val = allowedInput.trim();
    if (val && !field.allowedValues?.includes(val)) {
      update({ allowedValues: [...(field.allowedValues || []), val] });
    }
    setAllowedInput('');
  };

  return (
    <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
      <div className="flex justify-between items-center">
        <span className="text-sm font-medium text-gray-700">Field {index + 1}</span>
        <button
          type="button"
          onClick={() => onRemove(index)}
          className="text-red-500 hover:text-red-700 text-sm"
        >
          Remove
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Tag Key *</label>
          <input
            type="text"
            value={field.key}
            onChange={e => update({ key: e.target.value })}
            placeholder="e.g. CostCenter"
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Display Label *</label>
          <input
            type="text"
            value={field.label}
            onChange={e => update({ label: e.target.value })}
            placeholder="e.g. Cost Center"
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Default Value</label>
          <input
            type="text"
            value={field.defaultValue || ''}
            onChange={e => update({ defaultValue: e.target.value })}
            placeholder="Optional default"
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div className="flex items-center gap-2 pt-5">
          <input
            type="checkbox"
            id={`req-${index}`}
            checked={field.required}
            onChange={e => update({ required: e.target.checked })}
            className="h-4 w-4 text-blue-600 rounded"
          />
          <label htmlFor={`req-${index}`} className="text-sm text-gray-700">Required field</label>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Allowed Values <span className="text-gray-400">(leave empty to allow any)</span>
        </label>
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            value={allowedInput}
            onChange={e => setAllowedInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addAllowed())}
            placeholder="Type a value and press Enter"
            className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            type="button"
            onClick={addAllowed}
            className="px-3 py-1.5 text-sm bg-gray-200 hover:bg-gray-300 rounded transition-colors"
          >
            Add
          </button>
        </div>
        {field.allowedValues && field.allowedValues.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {field.allowedValues.map(v => (
              <span
                key={v}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-800 text-xs rounded-full"
              >
                {v}
                <button
                  type="button"
                  onClick={() => update({ allowedValues: field.allowedValues?.filter(x => x !== v) })}
                  className="text-blue-500 hover:text-blue-700 ml-0.5"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Template Form ────────────────────────────────────────────────────────────

interface TemplateFormProps {
  template: TagTemplate | null;
  onClose: () => void;
  onSuccess: () => void;
}

const TemplateForm: React.FC<TemplateFormProps> = ({ template, onClose, onSuccess }) => {
  const [name, setName] = useState(template?.name || '');
  const [description, setDescription] = useState(template?.description || '');
  const [category, setCategory] = useState(template?.category || 'custom');
  const [isRequired, setIsRequired] = useState(template?.isRequired || false);
  const [isEnabled, setIsEnabled] = useState(template?.isEnabled !== false);
  const [fields, setFields] = useState<TagField[]>(template?.fields?.length ? template.fields : [emptyField()]);
  const [error, setError] = useState('');

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = { name, description, category, isRequired, isEnabled, fields };
      return template
        ? apiClient.updateTagTemplate(template.templateId, payload)
        : apiClient.createTagTemplate(payload);
    },
    onSuccess,
    onError: (err: any) => setError(err.message || 'Failed to save template'),
  });

  const updateField = (index: number, updated: TagField) =>
    setFields(prev => prev.map((f, i) => (i === index ? updated : f)));

  const removeField = (index: number) =>
    setFields(prev => prev.filter((_, i) => i !== index));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !category) {
      setError('Name and category are required');
      return;
    }
    const invalidFields = fields.filter(f => !f.key.trim() || !f.label.trim());
    if (invalidFields.length) {
      setError('All tag fields must have a key and label');
      return;
    }
    setError('');
    saveMutation.mutate();
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">
          {template ? 'Edit Template' : 'New Tag Template'}
        </h2>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
          ← Back
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm space-y-4">
          <h3 className="font-semibold text-gray-800">Template Details</h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. AWS Cost Allocation"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {CATEGORY_OPTIONS.map(c => (
                  <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Describe the purpose of this template..."
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isRequired}
                onChange={e => setIsRequired(e.target.checked)}
                className="h-4 w-4 text-red-600 rounded"
              />
              <span className="text-sm text-gray-700">
                <strong>Enforce on all workstations</strong>
                <span className="text-gray-500 ml-1">(required template)</span>
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isEnabled}
                onChange={e => setIsEnabled(e.target.checked)}
                className="h-4 w-4 text-blue-600 rounded"
              />
              <span className="text-sm text-gray-700">Enabled</span>
            </label>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-semibold text-gray-800">Tag Fields</h3>
            <button
              type="button"
              onClick={() => setFields(prev => [...prev, emptyField()])}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              + Add Field
            </button>
          </div>

          {fields.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">
              No fields defined. Add tag fields to this template.
            </p>
          ) : (
            <div className="space-y-3">
              {fields.map((field, i) => (
                <FieldEditor
                  key={i}
                  field={field}
                  index={i}
                  onChange={updateField}
                  onRemove={removeField}
                />
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saveMutation.isPending}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saveMutation.isPending ? 'Saving...' : template ? 'Save Changes' : 'Create Template'}
          </button>
        </div>
      </form>
    </div>
  );
};

// ─── Main Management Panel ────────────────────────────────────────────────────

export const TagTemplateManagement: React.FC = () => {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<TagTemplate | null>(null);
  const [filter, setFilter] = useState<'all' | 'required' | 'optional' | 'disabled'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['tag-templates'],
    queryFn: () => apiClient.getTagTemplates(),
  });

  const templates = data?.templates || [];
  const summary = data?.summary;

  const filtered = templates
    .filter(t => {
      if (filter === 'required') return t.isRequired;
      if (filter === 'optional') return !t.isRequired && t.isEnabled;
      if (filter === 'disabled') return !t.isEnabled;
      return true;
    })
    .filter(t => !categoryFilter || t.category === categoryFilter)
    .filter(t =>
      !searchTerm ||
      t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (t.description || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

  const deleteMutation = useMutation({
    mutationFn: (templateId: string) => apiClient.deleteTagTemplate(templateId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tag-templates'] }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ templateId, patch }: { templateId: string; patch: Partial<TagTemplate> }) =>
      apiClient.updateTagTemplate(templateId, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tag-templates'] }),
  });

  const handleEdit = (t: TagTemplate) => {
    setEditingTemplate(t);
    setShowForm(true);
  };

  const handleDelete = (t: TagTemplate) => {
    if (confirm(`Delete template "${t.name}"? This cannot be undone.`)) {
      deleteMutation.mutate(t.templateId);
    }
  };

  if (showForm) {
    return (
      <TemplateForm
        template={editingTemplate}
        onClose={() => { setShowForm(false); setEditingTemplate(null); }}
        onSuccess={() => {
          setShowForm(false);
          setEditingTemplate(null);
          queryClient.invalidateQueries({ queryKey: ['tag-templates'] });
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Tag Templates</h2>
          <p className="mt-1 text-sm text-gray-600">
            Define tag schemas to enforce corporate security posture and cost allocation
          </p>
        </div>
        <button
          onClick={() => { setEditingTemplate(null); setShowForm(true); }}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          + New Template
        </button>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
            <div className="text-sm font-medium text-gray-600">Total Templates</div>
            <div className="mt-2 text-3xl font-bold text-gray-900">{summary.total}</div>
          </div>
          <div className="bg-red-50 p-4 rounded-lg border border-red-200 shadow-sm">
            <div className="text-sm font-medium text-red-600">Enforced</div>
            <div className="mt-2 text-3xl font-bold text-red-900">{summary.required}</div>
          </div>
          <div className="bg-green-50 p-4 rounded-lg border border-green-200 shadow-sm">
            <div className="text-sm font-medium text-green-600">Optional</div>
            <div className="mt-2 text-3xl font-bold text-green-900">{summary.optional}</div>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 shadow-sm">
            <div className="text-sm font-medium text-gray-600">Categories</div>
            <div className="mt-2 text-3xl font-bold text-gray-900">{summary.categories.length}</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
        <div className="flex flex-col sm:flex-row gap-4">
          <input
            type="text"
            placeholder="Search templates..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Categories</option>
            {(summary?.categories || CATEGORY_OPTIONS).map(c => (
              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
          {(['all', 'required', 'optional', 'disabled'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                filter === f ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Template List */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white p-12 rounded-lg border border-gray-200 text-center">
          <p className="text-gray-500 text-lg">No templates found</p>
          <p className="text-gray-400 text-sm mt-1">Create a template to start enforcing tag policies</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(template => (
            <TemplateCard
              key={template.templateId}
              template={template}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onToggleRequired={t =>
                toggleMutation.mutate({ templateId: t.templateId, patch: { isRequired: !t.isRequired } })
              }
              onToggleEnabled={t =>
                toggleMutation.mutate({ templateId: t.templateId, patch: { isEnabled: !t.isEnabled } })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Template Card ────────────────────────────────────────────────────────────

interface TemplateCardProps {
  template: TagTemplate;
  onEdit: (t: TagTemplate) => void;
  onDelete: (t: TagTemplate) => void;
  onToggleRequired: (t: TagTemplate) => void;
  onToggleEnabled: (t: TagTemplate) => void;
}

const TemplateCard: React.FC<TemplateCardProps> = ({
  template, onEdit, onDelete, onToggleRequired, onToggleEnabled,
}) => {
  const [expanded, setExpanded] = useState(false);

  const categoryColors: Record<string, string> = {
    security: 'bg-red-100 text-red-700',
    cost: 'bg-green-100 text-green-700',
    compliance: 'bg-yellow-100 text-yellow-700',
    environment: 'bg-blue-100 text-blue-700',
    project: 'bg-purple-100 text-purple-700',
    custom: 'bg-gray-100 text-gray-700',
  };

  const catColor = categoryColors[template.category] || 'bg-gray-100 text-gray-700';

  return (
    <div className={`bg-white rounded-lg border shadow-sm transition-all ${template.isEnabled ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-gray-900 truncate">{template.name}</h3>
              <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${catColor}`}>
                {template.category}
              </span>
              {template.isRequired && (
                <span className="px-2 py-0.5 text-xs rounded-full font-medium bg-red-100 text-red-700">
                  Enforced
                </span>
              )}
              {!template.isEnabled && (
                <span className="px-2 py-0.5 text-xs rounded-full font-medium bg-gray-100 text-gray-500">
                  Disabled
                </span>
              )}
            </div>
            {template.description && (
              <p className="mt-1 text-sm text-gray-500 truncate">{template.description}</p>
            )}
            <p className="mt-1 text-xs text-gray-400">
              {template.fields.length} tag field{template.fields.length !== 1 ? 's' : ''}
              {template.fields.filter(f => f.required).length > 0 && (
                <> · {template.fields.filter(f => f.required).length} required</>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setExpanded(e => !e)}
              className="text-sm text-gray-500 hover:text-gray-700 px-2 py-1"
            >
              {expanded ? 'Hide' : 'Fields'}
            </button>
            <button
              onClick={() => onToggleEnabled(template)}
              className="text-sm text-gray-500 hover:text-gray-700 px-2 py-1"
            >
              {template.isEnabled ? 'Disable' : 'Enable'}
            </button>
            <button
              onClick={() => onToggleRequired(template)}
              className={`text-sm px-2 py-1 rounded transition-colors ${
                template.isRequired
                  ? 'text-red-600 hover:text-red-800'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {template.isRequired ? 'Unenforce' : 'Enforce'}
            </button>
            <button
              onClick={() => onEdit(template)}
              className="text-sm text-blue-600 hover:text-blue-800 px-2 py-1"
            >
              Edit
            </button>
            <button
              onClick={() => onDelete(template)}
              className="text-sm text-red-500 hover:text-red-700 px-2 py-1"
            >
              Delete
            </button>
          </div>
        </div>

        {expanded && template.fields.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {template.fields.map(field => (
                <div key={field.key} className="p-2 bg-gray-50 rounded text-xs">
                  <div className="flex items-center gap-1 mb-0.5">
                    <span className="font-mono font-medium text-gray-800">{field.key}</span>
                    {field.required && (
                      <span className="text-red-500">*</span>
                    )}
                  </div>
                  <div className="text-gray-500">{field.label}</div>
                  {field.defaultValue && (
                    <div className="text-gray-400 mt-0.5">Default: {field.defaultValue}</div>
                  )}
                  {field.allowedValues && field.allowedValues.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {field.allowedValues.slice(0, 3).map(v => (
                        <span key={v} className="px-1 bg-blue-100 text-blue-700 rounded">{v}</span>
                      ))}
                      {field.allowedValues.length > 3 && (
                        <span className="text-gray-400">+{field.allowedValues.length - 3} more</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
