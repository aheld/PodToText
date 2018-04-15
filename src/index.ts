import {Context, Callback, APIGatewayEvent, S3Event} from "aws-lambda";
import {S3, TranscribeService, StepFunctions} from 'aws-sdk'
import * as fs from 'fs'
import * as path from 'path'
import {waterfall, parallel} from 'async'
import {exec} from 'child_process'
import {TranscriptionJob} from "aws-sdk/clients/transcribeservice";

const https = require("https");

// console.log(process.env['PATH'])
process.env['PATH'] = process.env['PATH'] + ":" + process.env['LAMBDA_TASK_ROOT']
// console.log(process.env['PATH'])

const s3 = new S3()

let Bucket: string;

exports.handler = (event: S3Event, context: Context, callback: Callback) => {
    console.log(`Debug: event received: ${JSON.stringify(event)}`)
    Bucket = event.Records[0].s3.bucket.name
    const params = {
        Bucket,
        Key: event.Records[0].s3.object.key
    }

    waterfall([
        x => downloadToTmp(params, x),
        // x => t(params, x),
        splitMp3,
        listOutputFiles,
        uploadOutputFiles,
        startStepFunctions
    ], function (err, result) {
        return callback(null, result)
    })
}

function startStepFunctions(files, cb6) {
    var params = {
        stateMachineArn: 'arn:aws:states:us-east-1:254372949584:stateMachine:TranscriptBuilder', /* required */
        input: JSON.stringify({files: files})
    }
    const stepfunctions = new StepFunctions({region: 'us-east-1'})
    stepfunctions.startExecution(params, cb6)
}

exports.startTranscribe = (event: any, context: Context) => {
    const jobPromises = event.files.map(startTranscribeJob)
    return Promise.all(jobPromises).then(jobs => {
        return {
            status: 'PENDING',
            Jobs: jobs
        }
    }).catch(e => e)
}

exports.checkTranscribeJobs = (event: any) => {
    const isSuc = (s) => (s.TranscriptionJob.TranscriptionJobStatus === 'COMPLETED')
    return Promise.all(
        event.Jobs.map(checkTranscribeJob)
    ).then(d => {
        console.log('result array', d)
        return {
            status: d.every(isSuc) ? 'SUCCEEDED' : 'PENDING',
            Jobs: d
        }
    })
}

exports.buildTranscript = (event: any) => {
    const keyParts = event.Jobs[0].TranscriptionJob.TranscriptionJobName.split('-')
    const key = 'transcripts/' + keyParts[0] + '/index.json'
    const chunks = event.Jobs.map(j => getTranscript(j.TranscriptionJob.TranscriptFileUri)
        .then(t => flattenTranscript(t)))
    return Promise.all(chunks).then(c =>
        c.reduce((acc: Array<any>, val: Array<any>) => {
            return acc.concat(val)
        }, [])
    ).then(trans => s3.putObject({
        Bucket: 'noagenda-source',
        Key: key,
        Body: JSON.stringify(trans),
        // ACL: 'public-read'
    }).promise())
}


function getTranscript(url: string) {
    return new Promise(((resolve, reject) =>
            https.get(url, res => {
                res.setEncoding("utf8");
                const {statusCode} = res
                let body = "";
                res.on("data", data => {
                    body += data;
                });
                res.on("end", () => {
                    // console.log(body)
                    if (statusCode != 200) return reject(body)
                    body = JSON.parse(body);
                    resolve(body)
                })
            }).on('error', (e) => {
                reject(e.message)
            })
    ))
}

function flattenTranscript(trans: any) {

    return trans.results
        .speaker_labels.segments
        .map(sect => getSection(sect))


    function getSection(sect) {
        let starts = sect.items.map(x => x.start_time)

        return {
            speaker: sect.speaker_label,
            text: trans.results.items
                .filter(x => starts.includes(x.start_time))
                .map(x => x.alternatives[0].content)
                .join(' ')
        }

    }
}

function startTranscribeJob(s3File: string) {
    var params = {
        LanguageCode: 'en-US',
        Media: {
            MediaFileUri: s3File,
        },
        MediaFormat: 'mp3',
        TranscriptionJobName: jobName(s3File),
        MediaSampleRateHertz: 44100,
        Settings: {
            MaxSpeakerLabels: 6,
            ShowSpeakerLabels: true
        }
    }
    var transcribeservice = new TranscribeService({region: 'us-east-1'})
    return new Promise((resolve: Function, reject: Function) => {
        return transcribeservice.startTranscriptionJob(params, function (err, data) {
            if (err) reject(err) // an error occurred
            else resolve(data)
        })
    })
}

function checkTranscribeJob(transcriptionJob: any) {
    var transcribeservice = new TranscribeService({region: 'us-east-1'})
    return new Promise((resolve, reject) => {
        console.log(transcriptionJob)
        var params = {
            TranscriptionJobName: transcriptionJob.TranscriptionJob.TranscriptionJobName
        }
        transcribeservice.getTranscriptionJob(params, function (err, job) {
            if (err) return reject(err)
            const name = job.TranscriptionJob.TranscriptionJobName
            const status = job.TranscriptionJob.TranscriptionJobStatus
            if (status === 'COMPLETED') {
                return resolve({
                    TranscriptionJob: {
                        TranscriptionJobName: job.TranscriptionJob.TranscriptionJobName,
                        TranscriptFileUri: job.TranscriptionJob.Transcript.TranscriptFileUri,
                        TranscriptionJobStatus: job.TranscriptionJob.TranscriptionJobStatus
                    }
                })
            }
            else {
                return resolve({
                    TranscriptionJob: {
                        TranscriptionJobName: job.TranscriptionJob.TranscriptionJobName,
                        TranscriptionJobStatus: job.TranscriptionJob.TranscriptionJobStatus
                    }
                })
            }
        })
    })
}


function jobName(s3File: string) {
    const parts = s3File.split('/').reverse()
    return parts[1] + '-' + parts[0] + (new Date()).getTime()
}

function t(params, cb) {
    const filepath = '/tmp/' + params.Key
    cb(null, filepath)

}

function downloadToTmp(params, cb) {
    console.log("Starting download")
    const filepath = '/tmp/' + params.Key
    s3.getObject(params, function (err, data) {
        if (err) {
            console.error(err.code, "-", err.message)
            return cb(err)
        }

        mkDirByPathSync(path.dirname(filepath))
        fs.writeFile(filepath, data.Body, function (err) {
            if (err) console.log(err.code, "-", err.message)
            return cb(err, filepath)
        })
    })
}

function splitMp3(filepath: string, cb2: Callback) {
    // console.log(filepath)
    // return cb(null, 'done')
    const input = filepath
    const dir = path.dirname(filepath)
    const cmd = `ffmpeg -i ${filepath} -f segment -segment_time 5400 -c copy ${dir}/out%03d.mp3`
    console.log(cmd)
    exec(cmd, (error, stdout, stderr) => {
        if (error) {
            console.error(`exec error: ${error}`)
            return cb2(error)
        }
        console.log(`stdout: ${stdout}`)
        console.log(`stderr: ${stderr}`)
        return cb2(null, dir)
    })
}

function listOutputFiles(dir: string, cb3: Callback) {
    console.log('listOutputFiles(', dir, ')')
    const files = fs.readdirSync(dir)
    console.log(dir, 'listing ', files)
    const outputFiles = files.filter(x => x.startsWith('out'))
        .map(x => dir + '/' + x)
    cb3(null, outputFiles)
}

function uploadOutputFiles(files: string[], cb4: Callback) {
    parallel(files.map(function (file) {
        return (c) => uploadFile(file, c)
    }), cb4)
}


function uploadFile(file: string, cb5: Callback) {
    fs.readFile(file, function (err, data: Buffer) {
        if (err) {
            throw err;
        }
        console.log('uploading ', file)
        // let base64data: Buffer = new Buffer(data, 'binary');
        const key = file.replace('/tmp/', 'split/')
        s3.putObject({
            Bucket: Bucket,
            Key: key,
            Body: data,
            // ACL: 'public-read'
        }, function (resp) {
            cb5(null, 's3://' + Bucket + '/' + key)
        })
    })
}

// https://stackoverflow.com/questions/31645738/how-to-create-full-path-with-nodes-fs-mkdirsync/40686853
function mkDirByPathSync(targetDir) {

    targetDir.split('/').reduce((parentDir, childDir) => {
        const curDir = path.resolve(parentDir, childDir);
        try {
            fs.mkdirSync(curDir);
            console.log(`Directory ${curDir} created!`);
        } catch (err) {
            if (!['EEXIST', 'EISDIR'].includes(err.code)) {
                throw err;
            }
            console.log(`Directory ${curDir} exists!`);
        }

        return curDir;
    }, '/')
}