'use strict';
const request = require('request');
const AWS = require('aws-sdk');
const fs = require('fs');
const zlib = require('zlib');

const path = 'static/';
const bucketName = process.env.BUCKET_NAME;

const confirmationTopicArn = process.env.AWS_CONFIRMATION_SNS_TOPIC_ANR;
const mailMessage = `Deploy to ${bucketName}/${path} succeeded!`;
const mailSubject = 'Deploy succeeded';

const sns = new AWS.SNS();
const s3 = new AWS.S3({
  params: {
    Bucket: bucketName
  }
});

const computeContentType = (filename) => {
  const parts = filename.split('.');
  switch (filename.split('.')[parts.length-1]) {
    case 'png':
      return "image/png";
    case 'html':
      return "text/html";
    case 'js':
      return "application/javascript";
    case 'css':
      return "text/css";
  }
};

const confirmUpload = (callback) => {
  sns.publish({
    Message: mailMessage,
    Subject: mailSubject,
    TopicArn: confirmationTopicArn,
  }, (err) => {
    if (err) callback(err, 'Failed to send confirmation');
    else callback(null, 'Done!');
  });
};

const putFileToS3 = (fileObject) => new Promise((resolve, reject) => {
  const gzip = zlib.createGzip();

  request(fileObject.download_url)
    .pipe(gzip)
    .pipe(fs.createWriteStream(`/tmp/${fileObject.name}`))
    .on('finish', () => {
      s3.upload({
        Bucket: bucketName,
        Key: fileObject.name,
        Body: fs.createReadStream(`/tmp/${fileObject.name}`),
        ACL: 'public-read',
        CacheControl: 'max-age=31536000',
        ContentType: computeContentType(fileObject.name),
        ContentEncoding: 'gzip',
      }, (error) => {
        if (error) return reject();
        else return resolve();
      });
    });
});

exports.handler = (event, context, callback) => {
  const downloadsUrl = JSON.parse(event.Records[0].Sns.Message).repository.contents_url.replace('{+path}', path);
  let processed = 0;

  const updateProgress = (totalCount) => {
    processed++;
    console.log(`Progress: ${processed} out of ${totalCount}`);
    if (processed === totalCount) {
      if (confirmationTopicArn) confirmUpload(callback);
      else callback(null, 'Done!');
    }
  };

  request({
    uri: downloadsUrl,
    headers: {
      'User-Agent': 'AWS Lambda Function' // Without that Github will reject all requests
    }
  }, (error, response, body) => {
    JSON.parse(body).forEach((fileObject) => {
      putFileToS3(fileObject)
      .then(() => updateProgress(JSON.parse(body).length))
      .catch((error) => callback(error, `Error while uploading ${fileObject.name} file to S3`));
    });
  });
};
