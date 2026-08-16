import { countDeploymentDoctorStatuses } from './DeploymentDoctor'
import type { DeploymentDoctorCheck } from '@/services/api'

function check(id: string, status: DeploymentDoctorCheck['status']): DeploymentDoctorCheck {
  return { id, category: 'test', title: id, status, required: status === 'fail', message: `${id} message` }
}

describe('countDeploymentDoctorStatuses', () => {
  it('counts every deployment-doctor state without trusting the backend summary', () => {
    expect(countDeploymentDoctorStatuses([
      check('one', 'pass'),
      check('two', 'warning'),
      check('three', 'fail'),
      check('four', 'skipped'),
      check('five', 'pass'),
    ])).toEqual({ pass: 2, warning: 1, fail: 1, skipped: 1, total: 5 })
  })

  it('returns zero counts for an empty report', () => {
    expect(countDeploymentDoctorStatuses([])).toEqual({ pass: 0, warning: 0, fail: 0, skipped: 0, total: 0 })
  })
})
