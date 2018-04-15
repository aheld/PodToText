const expect = require('chai').expect
const lambda = require('../dist/index')
const event = require('../event-new-show.json')
const eventJob = require('../event-start-job.json')
const eventJobStatus = require('../event-check-job-status.json')
const eventJobStatusComplete = require('../event-check-job-status-completed.json')
const eventDone = require('../event-all-done.json')

describe('Lambda invokation', () => {

  describe('handles correct event content by', () => {
    it.skip('returning the correct"', done => {
      lambda.handler(event, {}, (error, result) => {
        expect(error).to.equal(null)

        // expect(result).to.be.a('object')
        console.log('res', result)
        done()
      })
    }).timeout(1000 * 60 * 5);
  })
  describe('starts the transcribe jobs', () => {
    it.skip('returning the correct info', done => {
      const prom = lambda.startTranscribe(eventJob)
        .then(d => {
          console.log(d)
          done()
        })
    })
  })
  describe('checks the transcribe jobs', () => {
    it('returning the correct info', done => {
      const prom = lambda.checkTranscribeJobs(eventJobStatus)
        .then(d => {
          expect(d.status).to.equal('SUCCEEDED')
          console.log(d)
          d.Jobs.forEach( j => {}
            //expect(j.TranscriptFileUri).to.be.undefined
          )
          expect(d.Jobs.length).to.equal(3)
          done()
        })
    })
  })
  it.skip('returning the correct info for completed', done => {
    const prom = lambda.checkTranscribeJobs(eventJobStatusComplete)
      .then(d => {
        expect(d.status).to.equal('SUCCEEDED')
        d.Jobs.forEach( j =>
          expect(j.TranscriptFileUri).to.include('https://s3.amazonaws.com')
        )
        expect(d.Jobs.length).to.equal(3)
        done()
      })
  })
  describe('complete job', () => {
    it.skip('returning the correct info', done => {
      const prom = lambda.buildTranscript(eventDone)
        .then(d => {
          console.log('transcript', d)
          done()
        })
    })
  })
})