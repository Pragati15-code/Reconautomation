const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const app = express();
const { Pool } = require("pg");
const jwt = require('jsonwebtoken');
const bodyParser = require("body-parser");
const XLSX = require('xlsx');
const JSZip = require("jszip");
const { parse, isValid } = require('date-fns')
const moment = require('moment');

// Data base connection
const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "Recon_CA",
  password: "postgres",
  port: 5433, // Default PostgreSQL port
});

const pool2 = new Pool({
  user: "postgres",
  host: "localhost",
  database: "email_campaign_db",
  password: "root",
  port: 5432, // Default PostgreSQL port
});

const pool3 = new Pool({
  user: "postgres",
  host: "localhost",
  database: "Valuedx_Lead",
  password: "root",
  port: 5432,
});
console.log('Database connection Successful');
app.use(express.json());

// setting build

app.use(express.static(path.join(__dirname, '../project_ui/build')));

// app.get('/', function (req, res) {
//   res.sendFile(path.join(__dirname, '../project_ui/build', 'index.html'));
// });


//logging - winston
const winston = require("winston");
const logger = winston.createLogger({
  level: "info",
  //standard log format
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(
      (info) => `${info.timestamp} ${info.level}: ${info.message}`
    )
  ),
  // Log to the console and a file
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "logs/app.log" }),
  ],
});

const multer = require("multer");
const upload = multer();


app.use(cors());
const port = 8080;
//const port = 3001;
const unirest = require("unirest");

//Client Registration Post Api
app.use(bodyParser.json());
app.post("/api/register", async (req, res) => {
  const { clientName, email, mobileNo, state, country } = req.body;

  try {
    const result = await pool.query(
      "INSERT INTO client_registrations (client_name, email, mobile_no, state, country) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [clientName, email, mobileNo, state, country]
    );

    console.log("Client Registration successful:", result.rows[0]);
    res.status(201).json({ message: "Client Registration successful" });
  } catch (error) {
    console.error("Error during Client registration:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

var name;
app.get("/authenticate", (req, res) => {
  const { username, password } = req.query;
  name = username;
  logger.info(`Received a ${req.method} request for ${req.url}`);
  const request = unirest(
    "POST",
    "https://t4.automationedge.com/aeengine/rest/authenticate"
  ).query({ username, password });
  request.end(function (response) {
    console.log(response.body);
    if (response.error) {
      logger.error(`${response.error.message} from t4 instance`);
      res.status(401).send("Error occurred");
    } else {
      pool.query(
        "SELECT registerid FROM userregistration WHERE username=$1",
        [username],
        (error, result) => {
          if (error) {
            logger.error("Error querying userregistration table:", error);
            res.status(500).json({ error: "Database error occurred" });
            return;
          }

          console.log("result", result);

          // Check if user exists in the database
          if (!result.rows || result.rows.length === 0) {
            logger.warn(`User ${username} authenticated successfully but not found in userregistration table`);
            // User authenticated but not registered in local DB
            // Send response without registerid and credits
            res.status(200).json(response.body);
            return;
          }

          const registerid = result.rows[0].registerid;
          console.log(registerid);

          // Now, query the "users" table to get the remcredit
          pool.query(
            "SELECT remcredit,tdsremcredit FROM users WHERE registerid=$1",
            [registerid],
            (error, userResult) => {
              if (error) {
                logger.error("Error querying users table:", error);
                // Send response without credits but with registerid
                response.body.registerid = registerid;
                res.status(200).json(response.body);
                return;
              }

              // Check if user exists in users table
              if (!userResult.rows || userResult.rows.length === 0) {
                logger.warn(`RegisterID ${registerid} not found in users table`);
                // Send response with registerid but without credits
                response.body.registerid = registerid;
                res.status(200).json(response.body);
                return;
              }

              const remcredit = userResult.rows[0].remcredit;
              const tdsremcredit = userResult.rows[0].tdsremcredit;
              console.log("remcredit", remcredit);
              console.log("TDSremcredit", tdsremcredit);

              // Add both registerid and remcredit to the response.body
              response.body.registerid = registerid;
              response.body.remcredit = remcredit;
              response.body.tdsremcredit = tdsremcredit;

              console.log(
                "My response body after adding registerid and remcredit: ",
                response.body
              );

              console.log("My Reg ID: ", response.body.registerid);
              console.log(
                "response body tdsremcredit : ",
                response.body.tdsremcredit
              );
              logger.info(`Session Token Received from t3 instance`);

              // Send the response with both registerid and remcredit
              res.status(200).json(response.body);
            }
          );
        }
      );
    }
  });
  console.log(username, "this");
});


//send SMS through api



app.post('/send-message', async (req, res) => {
  try {
      const message = req.body.message;

      // Fetch all client mobile numbers from your PostgreSQL database
      const result = await pool.query('SELECT mobile_no FROM client_registrations');
      const clientMobileNumbers = result.rows.map(row => row.mobile_no);
     

      console.log("All CA Clients mobile numbers",clientMobileNumbers);
      // Send the message to each client using Fast2SMS API
      await Promise.all(clientMobileNumbers.map(async (mobileNumber) => {
          await sendSMS(mobileNumber, message);
      }));

      res.status(200).json({ success: true, message: 'Message sent to all clients.' });
  } catch (error) {
      console.error('Error sending message:', error);
      res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

async function sendSMS(mobileNumber, message) {
  try {
    const apiUrl = `https://www.fast2sms.com/dev/bulkV2?authorization=3DTkbLOyxhNGSF0faPdKp6c4X91wtIj2C7nmqovEQreVsYAuZMosIHP3h9Yl48QUjWtzgCx5ycBwkKJp&route=q&message=${encodeURIComponent(message)}&flash=0&numbers=${mobileNumber}`;
    const response = await axios.get(apiUrl);
    console.log('SMS sent to', mobileNumber, 'Response:', response.data);
  } catch (error) {
    console.error('Error sending SMS to', mobileNumber, 'Error:', error);
    throw error;
  }
}
//GST sample input files
app.get("/api/download-sample-file", async (req, res) => {
  const zip = new JSZip();

  // Add files to the zip archive
  zip.file(
    "Purchase_Templates.xlsx",
    fs.readFileSync("./Purchase_Templates.xlsx")
  );
  zip.file("GST_Template.xlsx", fs.readFileSync("./GST_Template.xlsx"));

  // Generate the zip file as a buffer
  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

  // Send the zip archive as a download
  res.setHeader("Content-Disposition", "attachment; filename=sample_files.zip");
  res.setHeader("Content-Type", "application/zip");
  res.send(zipBuffer);
});

//download TDS sample files
/* TDS: sample download (commented out)
app.get("/api/download-sample-file-tds", async (req, res) => {
  const zip = new JSZip();

  // Add files to the zip archive
  zip.file(
    "TDS_Receivable_As_Per_Accounts.xlsx",
    fs.readFileSync("./TDS_Receivable_As_Per_Accounts.xlsx")
  );
  // zip.file("TDS_Template.xlsx", fs.readFileSync("./TDS_Template.xlsx"));

  // Generate the zip file as a buffer
  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

  // Send the zip archive as a download
  res.setHeader("Content-Disposition", "attachment; filename=sample_tds_files.zip");
  res.setHeader("Content-Type", "application/zip");
  res.send(zipBuffer);
});
*/


const targetDirectory = path.join("C:", "Setup", "MYAPP", "UserFiles");
// Update this path to your desired folder

// upload files for GST
app.post("/upload", upload.array("files", 2), async (req, res) => {
  logger.info(`Received a ${req.method} request to upload files.`);
  const { files } = req;
  const username = name; // Assuming you have the username available
  const registerid = req.body.registerid;

  try {
    files.forEach((file, index) => {
      const originalFileName = file.originalname;
      const currentDate = new Date().toISOString().split("T")[0]; // Extract the date part
      const currentDateTime = new Date()
        .toISOString()
        .replace(/:/g, "-")
        .replace(/\..+/, ""); // Format date and time
      const newFileName = `${originalFileName}_${currentDateTime}${path.extname(
        originalFileName
      )}`; // Append date and time to the file name
      const savePath = path.join(targetDirectory, newFileName);

      // Use fs.writeFileSync to save the file to the target location
      fs.writeFileSync(savePath, file.buffer);

      logger.info(`File ${originalFileName} saved to ${savePath}`);

      // Database Insertion
      const filePath = savePath; // Store the file path
      console.log("file name", filePath);

      pool.query(
        "INSERT INTO userfiles (registerid, username, filepath, filename, date) VALUES ($1, $2, $3, $4, $5)",
        [registerid, username, filePath, newFileName, currentDate],
        (error, result) => {
          if (error) {
            logger.error("Error inserting file into the database:", error);
          } else {
            logger.info(
              `File ${originalFileName} inserted into the database for user ${username} with registerid ${registerid} and path ${filePath} and the date with ${currentDate}`
            );
            // Handle successful database insertion here
          }
        }
      );
    });
  } catch (error) {
    logger.error("Error saving uploaded files:", error);
    //res.status(500).send('Error saving uploaded files.');
  }

  const sessionToken = req.body.sessionToken;
  const tenant_name = req.body.tenantName;
  const tenant_orgcode = req.body.tenantOrgCode;
  const mailId = req.body.mailId;

  // Uploading file1 to the t3 server
  const response1 = await unirest
    .post("https://t4.automationedge.com/aeengine/rest/file/upload")
    .headers({
      "Content-Type": "multipart/form-data",
      "X-Session-Token": sessionToken,
    })
    .query({ workflow_name: "GSTR_2B_1", workflow_id: "4339" })
    .attach("file", files[0].buffer, { filename: files[0].originalname });

  const fileId1 = response1.body.fileId;
  console.log("My file id : ", fileId1);

  //uploading file2 to the t3 server
  const response2 = await unirest
    .post("https://t4.automationedge.com/aeengine/rest/file/upload")
    .headers({
      "Content-Type": "multipart/form-data",
      "X-Session-Token": sessionToken,
    })
    .query({ workflow_name: "GSTR_2B_1", workflow_id: "4339" })
    .attach("file", files[1].buffer, { filename: files[1].originalname });

  const fileId2 = response2.body.fileId;
  console.log("My file id : ", fileId2);
  console.log(req.body);
  // Executing workflow with input files
  await unirest
    .post("https://t4.automationedge.com/aeengine/rest/execute")
    .headers({
      "Content-Type": "application/json",
      "X-Session-Token": sessionToken,

    })
    .query({ workflow_name: "GSTR_2B_1", workflow_id: "4339" })
    .send({
      orgCode: tenant_orgcode,
      workflowName: "GSTR_2B_1",
      userId: tenant_name,
      source: "Rest Test",
      responseMailSubject: "null",
      params: [
        { name: "Input_File", value: fileId1, type: "File" },
        { name: "GST_File_Path", value: fileId2, type: "File" },
        { name: "Destination_Address", value: mailId, type: "String" },
      ],
    })
    .end(function (response) {
      if (response.error) {
        logger.error(`Error in executing workflow`);
        console.error(response.error);
        res.status(500).send("Error occurred while executing worfkflow");
      } else {
        logger.info(
          `GST Automation request ID received ${response.body.automationRequestId}`
        );
        res.status(200).json(response.body.automationRequestId);
      }
      console.log("GST Response Body is : ", response.body);
    });
});

/* TDS: upload endpoint (commented out)
app.post("/uploadtds", upload.array("files", 2), async (req, res) => {
  logger.info(`Received a ${req.method} request to upload files tds.`);
  const { files } = req;
  const username = name; // Assuming you have the username available
  const registerid = req.body.registerid;

  try {
    files.forEach((file, index) => {
      const originalFileName = file.originalname;
      const currentDate = new Date().toISOString().split("T")[0]; // Extract the date part
      const currentDateTime = new Date()
        .toISOString()
        .replace(/:/g, "-")
        .replace(/\..+/, ""); // Format date and time
      const newFileName = `${originalFileName}_${currentDateTime}${path.extname(
        originalFileName
      )}`; // Append date and time to the file name
      const savePath = path.join(targetDirectory, newFileName);

      // Use fs.writeFileSync to save the file to the target location
      fs.writeFileSync(savePath, file.buffer);

      logger.info(`File ${originalFileName} saved to ${savePath}, i am here`);

      // Database Insertion
      const filePath = savePath; // Store the file path
      console.log("file name", filePath);

      pool.query(
        "INSERT INTO userfiles (registerid, username, filepath, filename, date) VALUES ($1, $2, $3, $4, $5)",
        [registerid, username, filePath, newFileName, currentDate],
        (error, result) => {
          if (error) {
            logger.error("Error inserting file into the database:", error);
          } else {
            logger.info(
              `File ${originalFileName} inserted into the database for user ${username} with registerid ${registerid} and path ${filePath} and the date with ${currentDate}`
            );
            // Handle successful database insertion here
          }
        }
      );
    });
  } catch (error) {
    logger.error("Error saving uploaded files:", error);
    //res.status(500).send('Error saving uploaded files.');
  }

  const sessionToken = req.body.sessionToken;
  const tenant_name = req.body.tenantName;
  const tenant_orgcode = req.body.tenantOrgCode;
  const mailId = req.body.mailId;

  //Uploading tdsfile1 to t3 server
  const tdsresponse1 = await unirest
    .post("https://t4.automationedge.com/aeengine/rest/file/upload")
    .headers({
      "Content-Type": "multipart/form-data",
      "X-Session-Token": sessionToken,
    })
    .query({ workflow_name: "TDS_Tally_Recon", workflow_id: "5052" })
    .attach("file", files[0].buffer, { filename: files[0].originalname });

  const tdsfileId1 = tdsresponse1.body.fileId;
  console.log("My Tds first file id is : ", tdsfileId1);

  //uploading tdsfile2 t3 server
  const tdsresponse2 = await unirest
    .post("https://t4.automationedge.com/aeengine/rest/file/upload")
    .headers({
      "Content-Type": "multipart/form-data",
      "X-Session-Token": sessionToken,
    })
    .query({ workflow_name: "TDS_Tally_Recon", workflow_id: "5052" })
    .attach("file", files[1].buffer, { filename: files[1].originalname });

  const tdsfileId2 = tdsresponse2.body.fileId;
  console.log("My Tds Second file id is : ", tdsfileId2);

  // Executing workflow with tds and tally input files
  await unirest
    .post("https://t4.automationedge.com/aeengine/rest/execute")
    .headers({
      "Content-Type": "application/json",
      "X-Session-Token": sessionToken,
    })
    .query({ workflow_name: "TDS_Tally_Recon", workflow_id: "5052" })
    .send({
      orgCode: tenant_orgcode,
      workflowName: "TDS_Tally_Recon",
      userId: tenant_name,
      source: "Rest Test",
      responseMailSubject: null,
      params: [
        { name: "TDS_File", value: tdsfileId1, type: "File" },
        { name: "Tally_File", value: tdsfileId2, type: "File" },
        { name: "Email", value: mailId, type: "String" },
      ],
    })
    .end(function (response) {
      if (response.error) {
        logger.error(`Error in executing workflow`);
        console.error(response.error);
        res.status(500).send("Error occurred while executing worfkflow");
      } else {
        logger.info(
          `Automation request ID received of TDS Body${response.body.automationRequestId}`
        );
        res.status(200).json(response.body.automationRequestId);
      }
      console.log("Tds Response Body is : ", response.body);
    });
});
*/

// GST status api
app.get("/status", async (req, res) => {
  logger.info(
    `Received a ${req.method} request for ${req.url} to check status`
  );
  const { sessionToken, requestId, registerid } = req.query;

  let status = "pending";
  let fileName = "";
  let fileValue = "";
  let request_id = "";
  let rowvalue = "";
  let rowname = "";
  let rowcountvalue;
  let remaining_creditvalue;
  let total_creditremaining;

  // Checking Workflow status after every 3 seconds
  let counter = 0;

  while (status !== "Complete" && status !== "Failure") {
    console.log(sessionToken, requestId);
    const request = await unirest(
      "GET",
      `https://t4.automationedge.com/aeengine/rest/workflowinstances/${requestId}`
    )
      .headers({
        "Content-Type": "application/json",
        "X-Session-Token": sessionToken,
      })
      .end(function (response) {
        console.log(response.body);
        if (response.error) {
          console.log(response.error);
          res.status(500).send(response.error);
        } else {
          status = response.body.status;
          if (response.body.workflowResponse) {
            // fileName = JSON.parse(response.body.workflowResponse).outputParameters[1].name;
            // if (fileName == 'Output File.xlsx'){
            // fileValue = JSON.parse(response.body.workflowResponse).outputParameters[1].value;
            // }
            // else {
            //   fileValue = JSON.parse(response.body.workflowResponse).outputParameters[0].value;
            // }
            let outputParameters = JSON.parse(
              response.body.workflowResponse
            ).outputParameters;
            for (let i = 0; i < outputParameters.length; i++) {
              if (outputParameters[i].name === "Output File.xlsx") {
                fileValue = outputParameters[i].value;
                break;
              }
            }

            if (fileValue === null) {
              fileValue = outputParameters[0].value;
            }

            //Row Count
            if (response.body.workflowResponse) {
              rowname = JSON.parse(response.body.workflowResponse)
                .outputParameters[1].value;
              if (rowname == "value") {
                rowvalue = JSON.parse(response.body.workflowResponse)
                  .outputParameters[1].value;
              } else {
                rowvalue = JSON.parse(response.body.workflowResponse)
                  .outputParameters[0].value;
              }
            }
            //check username is present in db or not if present then add row count
            //var t4username=name;

            pool.query(
              "select rowcount, remcredit from users where registerid=$1",
              [registerid],
              (err, result) => {
                if (!err) {
                  const rows = result.rows;
                  console.log("First user details: ", rows);
                  if (rows.length > 0) {
                    rowcountvalue = rows[0].rowcount;
                    remaining_creditvalue = rows[0].remcredit;
                    console.log("Database Row Count: ", rowcountvalue);
                    console.log(
                      "Database Credit Value: ",
                      remaining_creditvalue
                    );

                    myrow_count = parseInt(rowvalue) + parseInt(rowcountvalue);
                    total_creditremaining =
                      parseInt(remaining_creditvalue) - parseInt(rowvalue);
                    console.log("Total Row Count", myrow_count);
                    console.log(
                      "Total Credit Remaining",
                      total_creditremaining
                    );

                    pool.query(
                      "UPDATE users SET rowcount = $1, remcredit = $2 WHERE registerid= $3",
                      [myrow_count, total_creditremaining, registerid],
                      (err, res) => {
                        if (!err) {
                          console.log("Insert Row Successfully ");
                        } else {
                          console.log("Error While Inserting the data");
                        }
                      }
                    );
                  }
                }
              }
            );
          }
          request_id = response.body.id;
        }
        if (status === "New" && !response.body.agentName) {
          counter++;
          if (counter === 10) {
            status = "no_agent";
          }
        } else {
          counter = 0;
        }
      });
    if (
      status === "Complete" ||
      status === "Failure" ||
      status === "no_agent"
    ) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  if (status === "Complete") {
    res.status(200).send({
      status: "Complete ! Please Check Your Mail",
      request_id: requestId,
      file_id: fileValue,
      row_count: rowvalue,
      total_credit: total_creditremaining,
    });
  } else if (status === "Failure") {
    res
      .status(200)
      .send({ status: "Failure ! Please Try Again (Check Input Files)" });
  } else if (status === "no_agent") {
    res.status(200).send({
      status: "Contact the Administrator Agent Is Under Maintainance",
    });
  }
});

/* TDS: status API (commented out)
app.get("/tdsstatus", async (req, res) => {
  logger.info(
    `Received a ${req.method} request for ${req.url} to check status`
  );
  const { sessionToken, requestId, registerid } = req.query;

  let status = "pending";
  let fileName = "";
  let fileValue = "";
  let request_id = "";
  let rowvalue = "";
  let rowname = "";
  let rowcountvalue;
  let remaining_creditvalue;
  let total_creditremaining;

  // Checking Workflow status after every 3 seconds
  let counter = 0;

  while (status !== "Complete" && status !== "Failure") {
    console.log(sessionToken, requestId);
    const request = await unirest(
      "GET",
      `https://t4.automationedge.com/aeengine/rest/workflowinstances/${requestId}`
    )
      .headers({
        "Content-Type": "application/json",
        "X-Session-Token": sessionToken,
      })
      .end(function (response) {
        console.log(response.body);
        if (response.error) {
          console.log(response.error);
          res.status(500).send(response.error);
        } else {
          status = response.body.status;
          if (response.body.workflowResponse) {
            let outputParameters = JSON.parse(
              response.body.workflowResponse
            ).outputParameters;
            for (let i = 0; i < outputParameters.length; i++) {
              if (outputParameters[i].name === "TDS_Receivable_Reco.xlsx") {
                fileValue = outputParameters[i].value;
                break;
              }
            }

            if (fileValue === null) {
              fileValue = outputParameters[0].value;
            }

            if (response.body.workflowResponse) {
              rowname = JSON.parse(response.body.workflowResponse)
                .outputParameters[1].value;
              if (rowname == "value") {
                rowvalue = JSON.parse(response.body.workflowResponse)
                  .outputParameters[1].value;
              } else {
                rowvalue = JSON.parse(response.body.workflowResponse)
                  .outputParameters[0].value;
              }
            }

            pool.query(
              "select tdsrowcount, tdsremcredit from users where registerid=$1",
              [registerid],
              (err, result) => {
                if (!err) {
                  const rows = result.rows;
                  if (rows.length > 0) {
                    rowcountvalue = rows[0].tdsrowcount;
                    remaining_creditvalue = rows[0].tdsremcredit;

                    myrow_count = parseInt(rowvalue) + parseInt(rowcountvalue);
                    total_creditremaining =
                      parseInt(remaining_creditvalue) - parseInt(rowvalue);

                    pool.query(
                      "UPDATE users SET tdsrowcount = $1, tdsremcredit = $2 WHERE registerid= $3",
                      [myrow_count, total_creditremaining, registerid],
                      (err, res) => {
                        // noop
                      }
                    );
                  }
                }
              }
            );
          }
          request_id = response.body.id;
        }
        if (status === "New" && !response.body.agentName) {
          counter++;
          if (counter === 10) {
            status = "no_agent";
          }
        } else {
          counter = 0;
        }
      });
    if (
      status === "Complete" ||
      status === "Failure" ||
      status === "no_agent"
    ) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  if (status === "Complete") {
    res.status(200).send({
      status: "Complete ! Please Check Your Mail",
      request_id: requestId,
      file_id: fileValue,
      row_count: rowvalue,
      total_credit: total_creditremaining,
    });
  } else if (status === "Failure") {
    res
      .status(200)
      .send({ status: "Failure ! Please Try Again (Check Input Files)" });
  } else if (status === "no_agent") {
    res.status(200).send({
      status: "Contact the Administrator Agent Is Under Maintainance",
    });
  }
});
*/

//Download api for GST
app.get("/download", async (req, res) => {
  const { sessionToken, requestId, fileId } = req.query;
  try {
    // Make the API request to the external download API
    const response = await axios({
      method: "GET",
      url: "https://t4.automationedge.com/aeengine/rest/file/download",
      params: { file_id: fileId, request_id: requestId }, // Set the fileID as a query parameter
      responseType: "stream",
      headers: {
        "X-Session-Token": sessionToken, // Add the session token in the Authorization header
      },
    });

    // Get the file name from the response headers or set a default name
    const fileName = response.headers["content-disposition"]
      ? response.headers["content-disposition"].split("filename=")[1]
      : "downloaded_file.xlsx"; // Replace 'downloaded_file.ext' with the desired default name

    // Set the headers for the file download
    res.setHeader("Content-disposition", "attachment; filename=" + fileName);
    res.setHeader(
      "Content-type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ); // Adjust the content-type based on your file type if needed

    // Stream the file to the client
    response.data.pipe(res);
  } catch (error) {
    console.error("Error downloading file:", error);
    res.status(500).send("Error downloading file");
  }
});

/* TDS: download endpoint (commented out)
app.get("/tdsdownload", async (req, res) => {
  const { sessionToken, requestId, fileId } = req.query;
  try {
    // Make the API request to the external download API
    const response = await axios({
      method: "GET",
      url: "https://t4.automationedge.com/aeengine/rest/file/download",
      params: { file_id: fileId, request_id: requestId }, // Set the fileID as a query parameter
      responseType: "stream",
      headers: {
        "X-Session-Token": sessionToken, // Add the session token in the Authorization header
      },
    });

    // Get the file name from the response headers or set a default name
    const fileName = response.headers["content-disposition"]
      ? response.headers["content-disposition"].split("filename=")[1]
      : "downloaded_file.xlsx"; // Replace 'downloaded_file.ext' with the desired default name

    // Set the headers for the file download
    res.setHeader("Content-disposition", "attachment; filename=" + fileName);
    res.setHeader(
      "Content-type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ); // Adjust the content-type based on your file type if needed

    // Stream the file to the client
    response.data.pipe(res);
  } catch (error) {
    console.error("Error downloading file:", error);
    res.status(500).send("Error downloading file");
  }
});
*/

// This is code for get the data from registrationpage into csv file and file is store in our local directory...

const csvFilePath = path.join(
  "C:",
  "Setup",
  "AE",
  "Process-Studio",
  "ps-workspace",
  "Bulk_User_Creation",
  "user_data.csv"
);

app.post("/api/addUser", (req, res) => {
  const userData = req.body;
  const csvData = `${userData.firstName},${userData.lastName},${userData.email},${userData.username}\n`;

  try {
    // Check if the CSV file exists, and if not, re-create it
    if (!fs.existsSync(csvFilePath)) {
      fs.writeFileSync(
        csvFilePath,
        "firstname, lastname, email, username\n",
        "utf-8"
      );
    }

    const existingData = fs.readFileSync(csvFilePath, "utf-8");
    const existingUsernames = existingData
      .split("\n")
      .slice(1)
      .map((line) => line.split(",")[3]);

    if (existingUsernames.includes(userData.username)) {
      return res.status(400).json({ error: "Username already exists" });
    }

    fs.appendFileSync(csvFilePath, csvData, "utf-8");
    console.log("User data appended to CSV file:", userData);
    res.status(200).json({ message: "User data added successfully" });
  } catch (error) {
    console.error("Error appending user data to CSV file:", error);
    res.status(500).json({ error: "Failed to add user data" });
  }
});

app.post('/executeprocess-gst', (req, res) => {
  const { username, password, financialYear,quarter, month, your_email } = req.body;

  unirest
    .post('https://t4.automationedge.com/aeengine/rest/execute')
    .headers({
      'Content-Type': 'application/json',
      'X-Session-Token': sessionToken,
    })
    .query({ workflow_name: 'GSTR_2B_Portal_Automation', workflow_id: '6008' })
    .send({
      orgCode: 'VAIBHAV_PARADHI_2113',
      workflowName: 'GSTR_2B_Portal_Automation',
      userId: 'VAIBHAV_PARADHI_2113',
      source: 'Rest Test',
      responseMailSubject: 'null',
      params: [
        { name: 'Username', value: username, type: 'String'},
        { name: 'Password', value: password, type: 'String'},
        { name:  'Financial_Year', value: financialYear, type: 'String'},
        { name:  'Quarter', value: quarter, type: 'String'},
        { name:  'Month', value: month, type: 'String'},
        { name: 'Your_Email', value: your_email, type: 'String'}
       
      ],
    })
    .end(function (response) {
      if (response.error) {
        console.error(response.error);
        res.status(500).send('Error occurred while executing the workflow');
      } else {
        const automationReqIdGST = response.body.automationRequestId; // Accessing automationReqIdGST from the response
        console.log('Request ID:', automationReqIdGST);

        res.status(200).json({ automationReqIdGST });
      }
    });
});

/* TDS: execute process endpoint (commented out)
app.post('/executeprocess-tds', (req, res) => {
  const { username, password, financialYear, your_email } = req.body;

  unirest
    .post('https://t4.automationedge.com/aeengine/rest/execute')
    .headers({
      'Content-Type': 'application/json',
      'X-Session-Token': sessionToken,
    })
    .query({ workflow_name: 'TDS_Portal_Automation', workflow_id: '6009' })
    .send({
      orgCode: 'VAIBHAV_PARADHI_2113',
      workflowName: 'TDS_Portal_Automation',
      userId: 'VAIBHAV_PARADHI_2113',
      source: 'Rest Test',
      responseMailSubject: 'null',
      params: [
        { name: 'Username', value: username, type: 'String'},
        { name: 'Password', value: password, type: 'String'},
        { name:  'Financial_Year', value: financialYear, type: 'String'},
        { name: 'Your_Email', value: your_email, type: 'String'}
      ],
    })
    .end(function (response) {
      if (response.error) {
        console.error(response.error);
        res.status(500).send('Error occurred while executing the workflow');
      } else {
        const automationReqIdTDS = response.body.automationRequestId; // Accessing automationReqIdTDS from the response
        console.log('Request ID:', automationReqIdTDS);

        res.status(200).json({ automationReqIdTDS });
      }
    });
});
*/

//*****************************************************************************
//Auto Intent Application API

// Register Details

app.post('/api/RegisterDetails', async (req, res) => {
  const { YOUR_NAME, YOUR_EMAIL, EMAIL_PASSWORD, YOUR_MOBILE, YOUR_COMPANY_NAME, YOUR_POSITION, USERNAME, SCHEDULE_LINK } = req.body;

  if (!YOUR_NAME || !YOUR_EMAIL || !EMAIL_PASSWORD || !YOUR_MOBILE || !YOUR_COMPANY_NAME || !YOUR_POSITION || !USERNAME || !SCHEDULE_LINK) {
    return res.status(400).json({ message: 'All fields are required.' });
  }

  try {
    const result = await pool2.query(
      `INSERT INTO register_details (your_name, your_email, email_password, mob_number, company_name, your_position, schedule_link, username)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [YOUR_NAME, YOUR_EMAIL, EMAIL_PASSWORD, YOUR_MOBILE, YOUR_COMPANY_NAME, YOUR_POSITION, SCHEDULE_LINK, USERNAME]
    );

    res.status(201).json({ message: 'Registration successful!', data: result.rows[0] });
  } catch (error) {
    console.error('Error inserting data:', error);
    res.status(500).json({ message: 'An error occurred while processing your request.' });
  }
});

// Endpoint to get user details based on username
app.get('/api/getUserDetails', async (req, res) => {
  const { username } = req.query;

  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  try {
    // Query to fetch user details based on username
    const result = await pool2.query(
      'SELECT * FROM register_details WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Return the fetched data
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching user details:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

var sessionToken = '';

// Login endpoint
app.get('/api/loginAutoIntent', (req, res) => {
  const { username, password } = req.query;
  console.log('Received username:', username);
  console.log('Received password:', password);

  // First authentication using user-provided credentials
  unirest
    .post('https://t4.automationedge.com/aeengine/rest/authenticate')
    .query({ username, password })
    .end(function (response) {
      if (response.error) {
        res.status(401).send('Authentication failed');
      } else {
        sessionToken = response.body.sessionToken;
        console.log('Session Token:', sessionToken);

        // Second authentication using hardcoded credentials
        unirest
          .post('https://t4.automationedge.com/aeengine/rest/authenticate')
          .query({ username: 'VAIBHAV_PARADHI_2113', password: 'Recon@123' })
          .end(function (vaibhavResponse) {
            if (vaibhavResponse.error) {
              res.status(401).send('Failed to authenticate VAIBHAV_PARADHI_2113');
            } else {
              const vaibhavsessionToken = vaibhavResponse.body.sessionToken;
              console.log('Vaibhav Session Token:', vaibhavsessionToken);

              // Call the agent state API using the vaibhavsessionToken
              unirest
                .get('https://t4.automationedge.com/aeengine/rest/VAIBHAV_PARADHI_2113/monitoring/agents')
                .query({ type: 'AGENT', offset: 0, size: 10 })
                .headers({
                  'Content-Type': 'application/json',
                  'X-Session-Token': vaibhavsessionToken,
                })
                .end(function (agentResponse) {
                  if (agentResponse.error) {
                    res.status(500).send('Failed to retrieve agent data');
                  } else {
                    const agentData = agentResponse.body;
                    const agentState = agentData[0]?.agentState; // Assuming you want the state of the first agent

                    // Attach the agentState to the original authentication response
                    const finalResponse = {
                      ...response.body,
                      agentState: agentState || 'UNKNOWN',
                    };
                    res.status(200).json(finalResponse);
                  }
                });
            }
          });
      }
    });
});


// Configure multer for file storage
const storage2 = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, 'uploads'))
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname)
  }
});

const upload2 = multer({ storage: storage2 });

// API Multiple records through excel
app.post('/api/uploadDetails', upload2.fields([
  { name: 'EXCEL_FILE', maxCount: 1 },
  { name: 'IMAGE_FILE', maxCount: 1 }
]), (req, res) => {
  try {
    console.log('Files:', req.files);
    console.log('Body:', req.body);

    // Extract data from the request body
    const { YOUR_NAME, username, YOUR_EMAIL, EMAIL_PASSWORD, YOUR_MOBILE, YOUR_COMPANY_NAME, YOUR_POSITION, SCHEDULE_LINK, GOOGLE_FORM_LINK } = req.body;
   
    // Extract paths and original file names from the uploaded files
    const EXCEL_FILE_PATH = req.files['EXCEL_FILE'] ?
      path.join(__dirname, 'uploads', req.files['EXCEL_FILE'][0].filename) : '';
    const EXCEL_FILE_NAME = req.files['EXCEL_FILE'] ?
      req.files['EXCEL_FILE'][0].originalname : '';
    const HEADER_IMAGE_PATH = req.files['IMAGE_FILE'] ?
      path.join(__dirname, 'uploads', req.files['IMAGE_FILE'][0].filename) : '';
    const HEADER_IMAGE_NAME = req.files['IMAGE_FILE'] ?
      req.files['IMAGE_FILE'][0].originalname : '';

    console.log('Excel File Path:', EXCEL_FILE_PATH);
    console.log('Excel File Name:', EXCEL_FILE_NAME);
    console.log('Image Path:', HEADER_IMAGE_PATH);
    console.log('Image Name:', HEADER_IMAGE_NAME);

    // Make a POST request to the external API
    unirest
      .post('https://t4.automationedge.com/aeengine/rest/execute')
      .headers({
        'Content-Type': 'application/json',
        'X-Session-Token': sessionToken, // Ensure sessionToken is defined
      })
      .query({ workflow_name: 'Auto_Mul_Gen_BOT', workflow_id: '6652' })
      .send({
        orgCode: 'VAIBHAV_PARADHI_2113',
        workflowName: 'Auto_Mul_Gen_BOT',
        userId: 'Vaibhav_Paradhi_2113',
        source: 'Rest Test',
        responseMailSubject: 'null',
        params: [
          { name: 'YOUR_NAME', value: YOUR_NAME, type: 'String' },
          { name: 'USER_NAME', value: username, type: 'String' },
          { name: 'YOUR_EMAIL', value: YOUR_EMAIL, type: 'String' },
          { name: 'EMAIL_PASSWORD', value: EMAIL_PASSWORD, type: 'String' },
          { name: 'YOUR_MOBILE', value: YOUR_MOBILE, type: 'String' },
          { name: 'YOUR_COMPANY_NAME', value: YOUR_COMPANY_NAME, type: 'String' },
          { name: 'YOUR_POSITION', value: YOUR_POSITION, type: 'String' },
          { name: 'SCHEDULE_LINK', value: SCHEDULE_LINK, type: 'String' },
          { name: 'EXCEL_FILE_PATH', value: EXCEL_FILE_PATH, type: 'File' },
          { name: 'EXCEL_FILE_NAME', value: EXCEL_FILE_NAME, type: 'String' },
          { name: 'HEADER_IMAGE_PATH', value: HEADER_IMAGE_PATH, type: 'File' },
          { name: 'HEADER_IMAGE_NAME', value: HEADER_IMAGE_NAME, type: 'String' },
          { name: 'GOOGLE_FORM_LINK', value: GOOGLE_FORM_LINK, type: 'String'},
        ],
      })
      .end(function (response) {
        if (response.error) {
          console.error('Error from external API:', response.error);
          res.status(500).send('Error occurred while executing the workflow');
        } else {
          const automationRequestId = response.body.automationRequestId;
          console.log('Request ID:', automationRequestId);
          res.status(200).json({ automationRequestId });
        }
      });
  } catch (error) {
    console.error('Error processing request:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Configure multer for file storage
const storage1 = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, 'uploads'))
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname)
  }
});

const upload1 = multer({ storage: storage1 });

// API endpoint
app.post('/api/uploadSingleDetails', upload1.fields([
  { name: 'IMAGE_FILE', maxCount: 1 }
]), (req, res) => {
  try {
    console.log('Files:', req.files);
    console.log('Body:', req.body);

    // Extract data from the request body
    const { YOUR_NAME, username, YOUR_EMAIL, EMAIL_PASSWORD, YOUR_MOBILE, YOUR_COMPANY_NAME, YOUR_POSITION, SCHEDULE_LINK, CLIENT_NAME, CLIENT_EMAIL, DETAILS, GOOGLE_FORM_LINK } = req.body;
   
    // Extract paths and original file names from the uploaded image file
    const HEADER_IMAGE_PATH = req.files['IMAGE_FILE'] ?
      path.join(__dirname, 'uploads', req.files['IMAGE_FILE'][0].filename) : '';
    const HEADER_IMAGE_NAME = req.files['IMAGE_FILE'] ?
      req.files['IMAGE_FILE'][0].originalname : '';

    console.log('Image Path:', HEADER_IMAGE_PATH);
    console.log('Image Name:', HEADER_IMAGE_NAME);

    // Make a POST request to the external API
    unirest
      .post('https://t4.automationedge.com/aeengine/rest/execute')
      .headers({
        'Content-Type': 'application/json',
        'X-Session-Token': sessionToken,
      })
      .query({ workflow_name: 'Auto_SU_Gen_BOT', workflow_id: '6653' })
      .send({
        orgCode: 'VAIBHAV_PARADHI_2113',
        workflowName: 'Auto_SU_Gen_BOT',
        userId: 'Vaibhav_Paradhi_2113',
        source: 'Rest Test',
        responseMailSubject: 'null',
        params: [
          { name: 'YOUR_NAME', value: YOUR_NAME, type: 'String' },
          { name: 'YOUR_EMAIL', value: YOUR_EMAIL, type: 'String' },
          { name: 'EMAIL_PASSWORD', value: EMAIL_PASSWORD, type: 'String' },
          { name: 'YOUR_MOBILE', value: YOUR_MOBILE, type: 'String' },
          { name: 'YOUR_COMPANY_NAME', value: YOUR_COMPANY_NAME, type: 'String' },
          { name: 'YOUR_POSITION', value: YOUR_POSITION, type: 'String' },
          { name: 'SCHEDULE_LINK', value: SCHEDULE_LINK, type: 'String' },
          { name: 'CLIENT_NAME', value: CLIENT_NAME, type: 'String' },
          { name: 'CLIENT_EMAIL', value: CLIENT_EMAIL, type: 'String' },
          { name: 'DETAILS', value: DETAILS, type: 'String' },
          { name: 'USER_NAME', value: username, type: 'String' },
          { name: 'HEADER_IMAGE_PATH', value: HEADER_IMAGE_PATH, type: 'File' },
          { name: 'HEADER_IMAGE_NAME', value: HEADER_IMAGE_NAME, type: 'String' },
          { name: 'GOOGLE_FORM_LINK', value: GOOGLE_FORM_LINK, type: 'String'},
        ],
      })
      .end(function (response) {
        if (response.error) {
          console.error('Error from external API:', response.error);
          res.status(500).send('Error occurred while executing the workflow');
        } else {
          const automationRequestId = response.body.automationRequestId;
          console.log('Request ID SU :', automationRequestId);
          res.status(200).json({ automationRequestId });
        }
      });
  } catch (error) {
    console.error('Error processing request:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Endpoint to fetch email details where email_status is 'pending' and username matches
app.get('/api/email-details', async (req, res) => {
  const { username } = req.query;

  try {
    const result = await pool2.query(
      'SELECT id, client_name, client_email, details, subject, email_body FROM email_details WHERE email_status = $1 AND user_name = $2',
      ['pending', username]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching email details:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// Endpoint to update email details
app.put('/api/update-email-details', async (req, res) => {
  const client = await pool2.connect();
  try {
    const { records } = req.body;

    // Check if records is an array and has at least one record
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'No records provided for update' });
    }

    // Begin transaction
    await client.query('BEGIN');

    // Prepare the query to update records
    const updateQuery = `
      UPDATE email_details
      SET client_name = $1,
          client_email = $2,
          subject = $3,
          email_body = $4,
          email_status = 'checked'
      WHERE id = $5
    `;

    // Loop through each record and update it
    for (const record of records) {
      const { id, client_name, client_email, subject, email_body } = record;

      await client.query(updateQuery, [
        client_name,
        client_email,
        subject,
        email_body,
        id
      ]);
    }

    // Commit transaction
    await client.query('COMMIT');

    res.status(200).json({ message: 'Records updated successfully' });
  } catch (error) {
    // Rollback transaction in case of error
    await client.query('ROLLBACK');
    console.error('Error updating records:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  } finally {
    client.release();
  }
});

app.post('/api/send-mail', async (req, res) => {
  const username = req.query.username; // Use req.query to extract username from query parameters

  try {
    // Check database for records with email_status = "checked"
    const result = await pool2.query(
      'SELECT * FROM email_details WHERE user_name = $1 AND email_status = $2',
      [username, 'checked']
    );

    if (result.rows.length === 0) {
      // No records found
      console.log('no records found');
      return res.status(404).json({ msg: "No records to be found" });
    }


    // Records found, proceed with external API call
    unirest
      .post('https://t4.automationedge.com/aeengine/rest/execute')
      .headers({
        'Content-Type': 'application/json',
        'X-Session-Token': sessionToken, // Use the session token obtained
      })
      .query({ workflow_name: 'Auto_Gen_BOT_Sender', workflow_id: '6654' })
      .send({
        orgCode: 'VAIBHAV_PARADHI_2113',
        workflowName: 'Auto_Gen_BOT_Sender',
        userId: 'Vaibhav_Paradhi_2113',
        source: 'Rest Test',
        responseMailSubject: 'null',
        params: [
          { name: 'USER_NAME', value: username, type: 'String' },
        ],
      })
      .end(function (response) {
        if (response.error) {
          console.error(response.error);
          res.status(500).send('Error occurred while executing the workflow');
        } else {
          const automationRequestId = response.body.automationRequestId; // Accessing automationRequestId from the response
          console.log('Request ID mail sender:', automationRequestId);
          res.status(200).json({ automationRequestId });
        }
      });
  } catch (error) {
    console.error('Database query error:', error);
    res.status(500).send('Error occurred while checking database');
  }
});

//Delete APi
app.delete('/api/delete-dashboard-email/:id', async (req, res) => {
  const { id } = req.params;
 
  try {
    const result = await pool2.query('DELETE FROM email_details WHERE id = $1 RETURNING *', [id]);
   
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Email detail not found' });
    }
   
    res.status(200).json({ message: 'Email detail deleted successfully'});
  } catch (error) {
    console.error('Error deleting email detail:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

//***********************************************************************************************
// Requiremment and Lead App API

const storage = multer.memoryStorage();
const leadupload = multer({ storage });

app.post("/api/lead-register", async (req, res) => {
  const { name, email, contactNo, username, password } = req.body;
  const studentrole = 'user';

  try {
    await pool3.query(
      "INSERT INTO register (name, email_id, contact_no, username, password, role) VALUES ($1, $2, $3, $4, $5, $6)",
      [name, email, contactNo, username, password, studentrole]
    );
    console.log("Form details inserted successfully");
    res.status(201).json({ message: "Register User successfully" });
  } catch (err) {
    console.error("Error executing query", err);
    res.status(500).json({ message: "User already exists with this email." });
  }
});

// Login API
app.post("/api/lead-login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await pool3.query(
      "SELECT username, name, role, userid FROM register WHERE username = $1 AND password = $2",
      [username, password]
    );
    if (result.rows.length > 0) {
      const { username, name, role, userid, company_name, company_website } = result.rows[0];
      const sessionToken = jwt.sign({ username }, "your_secret_key", {
        expiresIn: "1h",
      });

      res.json({
        message: "Login successful",
        token: sessionToken,
        name: name,
        role: role,
        userid: userid,
        company_name: company_name,
        company_website: company_website
      });
    } else {
      res.status(401).json({ message: "Invalid username or password" });
    }
  } catch (err) {
    console.error("Error executing query", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Staffing Requirement Submission API
app.post('/api/staffing-requirements', async (req, res) => {
  try {
    const {
      requirement_id,
      job_id,
      position,
      end_client,
      must_have_skills,
      secondary_skills,
      location,
      experience_range,
      open_date,
      requirement_given_by,
      priority,
      status,
      budget,
      no_of_positions,
      time_to_onboard,
      jd_available,
      closed_date,
      submission,
      remarks,
      candidate_name,
      user_id,
    } = req.body;

    // Insert into database
    await pool3.query(
      `INSERT INTO staffing_requirements
      (requirement_id, job_id, position, end_client, must_have_skills, secondary_skills, location, experience_range, open_date, requirement_given_by, priority, status, budget, no_of_positions, time_to_onboard, jd_available, closed_date, submission, remarks, candidate_name, userid)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
      [
        requirement_id,
        job_id,
        position,
        end_client,
        must_have_skills,
        secondary_skills,
        location,
        experience_range,
        open_date,
        requirement_given_by,
        priority,
        status,
        budget,
        no_of_positions,
        time_to_onboard,
        jd_available,
        closed_date,
        submission,
        remarks,
        candidate_name,
        user_id
      ]
    );

    res.status(200).json({ message: 'Staffing requirement created successfully!' });
  } catch (error) {
    console.error('Error creating staffing requirement:', error);
    res.status(500).json({ error: 'Failed to create staffing requirement.' });
  }
});

// API endpoint to fetch all staffing requirements
 app.get('/api/staffing-requirements', async (req, res) => {
 try {
  const result = await pool3.query('SELECT * FROM staffing_requirements ORDER BY created_at DESC');
  res.json(result.rows);
} catch (error) {
  console.error('Error fetching staffing requirements:', error);
  res.status(500).send('Server error');
}
});

// Lead details submission API
app.post('/api/lead-generation', async (req, res) => {
const {
  accountName,
  rpaPlatformUser,
  firstName,
  lastName,
  titles,
  contactNo,
  emailId,
  linkedinId,
  location,
  leadGenerationDate,
  userId
} = req.body;

try {
  const result = await pool3.query(
    `INSERT INTO leads (account_name, rpa_platform_user, first_name, last_name, titles, contact_no, email_id, linkedin_id, location, lead_generation_date, userid)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [accountName, rpaPlatformUser, firstName, lastName, titles, contactNo, emailId, linkedinId, location, leadGenerationDate, userId]
  );

  res.status(201).json(result.rows[0]);
} catch (error) {
  console.error('Error inserting lead:', error);
  res.status(500).json({ error: 'Internal Server Error' });
}
});
//API for fetch details for User dashboard
app.get('/api/dashboard/:userId/:table', async (req, res) => {
const { userId, table } = req.params;

// Validate inputs
if (!userId || !table) {
  return res.status(400).json({ error: 'User ID and table name are required' });
}

if (!['staffing_requirements', 'leads'].includes(table)) {
  return res.status(400).json({ error: 'Invalid table name' });
}

try {
  // Fetch all records from the specified table for the user
  const result = await pool3.query(`SELECT * FROM ${table} WHERE userid = $1`, [userId]);
  res.status(200).json(result.rows);
} catch (error) {
  console.error('Error fetching records:', error);
  res.status(500).json({ error: 'Internal Server Error' });
}
});

// Daily Report
app.post("/api/dailyReport", async (req, res) => {
  const {
    userId,
    reportDate,
    mailSent,
    dataExtractionLinkedIn,
    connectionRequestSent,
    requestAccepted,
    messageSent,
    dataExtractionOilGas,
    calls,
    positiveResponse,
    remark
  } = req.body;

  console.log("Request Body", req.body);

  // SQL Query to check if a record for the same userId and reportDate already exists
  const checkQuery = `
    SELECT * FROM daily_reports
    WHERE userid = $1 AND daily_report_date = $2;
  `;

  const insertQuery = `
    INSERT INTO daily_reports (
      userid, daily_report_date, mail_sent, data_extraction_linkedin, connection_request_sent, request_accepted,
      message_sent, data_extraction_oil_gas, calls, positive_response, remark
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *;
  `;

  const values = [
    userId,
    reportDate,
    mailSent,
    dataExtractionLinkedIn,
    connectionRequestSent,
    requestAccepted,
    messageSent,
    dataExtractionOilGas,
    calls,
    positiveResponse,
    remark
  ];

  try {
    // Check if the record for the same userId and reportDate already exists
    const checkResult = await pool3.query(checkQuery, [userId, reportDate]);

    if (checkResult.rows.length > 0) {
      // If a record exists, return a message without inserting a new one
      return res.status(409).json({ message: "You have already submitted a report for this date" });
    }

    // If no record exists, proceed to insert the new data
    const result = await pool3.query(insertQuery, values);
    res.status(201).json({ message: "Daily Report Submitted Successfully", data: result.rows[0] });
  } catch (error) {
    console.error("Error inserting data:", error);
    if (error.constraint === "daily_reports_user_id_fkey") {
      res.status(400).json({ message: "Invalid userId: The specified user does not exist." });
    } else {
      res.status(500).json({ message: "Failed to submit data", error });
    }
  }
});

  // Define expected headers and their mapping
  const expectedHeaders1 = {
    account_name: "Account Name",
    rpa_platform_user: "RPA Platform User",
    first_name: "First Name",
    last_name: "Last Name",
    titles: "Title",
    contact_no: "Contact No",
    email_id: "Mail ID",
    linkedin_id: "LinkedIn Id",
    location: "Location",
    lead_generation_date: "Lead Generation Date",
    remark: "Remarks"
  };
  const parseExcelSerialDate = (serial) => {
    // Excel serial date starts at 1900-01-01 with a base offset
    // Excel incorrectly considers 1900 as a leap year
    const baseDate = new Date(Date.UTC(1900, 0, 1));
    const excelDate = new Date(baseDate.getTime() + (serial - 2) * 24 * 60 * 60 * 1000);
   
    // Handle Excel's leap year bug for dates before March 1, 1900
    if (serial < 60) {
      excelDate.setDate(excelDate.getDate() - 1);
    }
 
    return excelDate;
  };
 
 
  const parseDate = (dateStr) => {
    if (dateStr === undefined || dateStr === null) {
      console.error('Invalid date input:', dateStr);
      return null;
    }
 
    const dateStrAsString = String(dateStr).trim();
 
    if (dateStrAsString === '') {
      console.error('Empty date input:', dateStr);
      return null;
    }
 
    // Check if the dateStrAsString is an Excel serial date
    const serialDate = parseFloat(dateStrAsString);
    if (!isNaN(serialDate)) {
      const excelDate = parseExcelSerialDate(serialDate);
      if (excelDate) return excelDate;
    }
 
    // Attempt to parse the date in 'DD/MM/YYYY' format
    const parsedDate = moment(dateStrAsString, 'DD/MM/YYYY', true);
    if (parsedDate.isValid()) {
      return parsedDate.toDate();
    }
 
    console.error('Invalid date input:', dateStrAsString);
    return null;
  };
 
  // Endpoint to handle file upload
  app.post('/api/upload/leads', leadupload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
 
      const userId = req.body.userId;
      if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
      }
 
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
 
      const headers = data[0].reduce((acc, header, index) => {
        const key = Object.keys(expectedHeaders1).find(
          key => expectedHeaders1[key].toLowerCase() === header.toLowerCase()
        );
        if (key) acc[key] = index;
        return acc;
      }, {});
 
      const missingHeaders = Object.keys(expectedHeaders1).filter(
        key => !(key in headers)
      );
      if (missingHeaders.length > 0) {
        return res.status(400).json({ error: `Missing headers: ${missingHeaders.join(', ')}` });
      }
 
      const rows = data.slice(1);
      const client = await pool3.connect();
      try {
        await client.query('BEGIN');
 
        for (const row of rows) {
          const leadGenerationDate = parseDate(row[headers.lead_generation_date]);
 
          const values = [
            row[headers.account_name] || 'N/A',
            row[headers.rpa_platform_user] || 'N/A',
            row[headers.first_name] || 'N/A',
            row[headers.last_name] || 'N/A',
            row[headers.titles] || 'N/A',
            row[headers.contact_no] || 'N/A',
            row[headers.email_id] || 'N/A',
            row[headers.linkedin_id] || 'N/A',
            row[headers.location] || 'N/A',
            leadGenerationDate,
            userId,
            row[headers.remark] || 'N/A',
          ];
 
          await client.query(
            `INSERT INTO leads (account_name, rpa_platform_user, first_name, last_name, titles, contact_no, email_id, linkedin_id, location, lead_generation_date, userid, remark) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            values
          );
        }
 
        await client.query('COMMIT');
        res.status(200).json({ message: 'File uploaded and data saved successfully' });
      } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error inserting data:', error);
        res.status(500).json({ error: 'Failed to save data' });
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error processing file:', error);
      res.status(500).json({ error: 'Failed to process file' });
    }
  });

const expectedHeaders = {
  requirement_id: 'Requirement ID of client/partner',
  position: 'Position',
  end_client: 'End Client',
  must_have_skills: 'Must Have Skills',
  secondary_skills: 'Secondary Skills',
  location: 'Location',
  experience_range: 'Exp range',
  req_date: 'Requirement Date',
  requirement_given_by: 'Req given by',
  priority: 'Priority',
  status: 'Status',
  budget: 'Client Budget',
  no_of_positions: 'No. Of position',
  time_to_onboard: 'Time to onboard',
  jd_available: 'JD Available',
  closed_date: 'Closed Date',
  submission: 'Submission',
  remarks: 'Remarks',
  candidate_name: 'Candidate Name',
};

app.post('/api/upload/staffing', leadupload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Parse Excel file
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    // Extract headers
    const headers = data[0].reduce((acc, header, index) => {
      const key = Object.keys(expectedHeaders).find(
        key => expectedHeaders[key].toLowerCase() === header.toLowerCase()
      );
      if (key) acc[key] = index;
      return acc;
    }, {});

    // Validate headers
    const missingHeaders = Object.keys(expectedHeaders).filter(
      key => !(key in headers)
    );
    if (missingHeaders.length > 0) {
      return res.status(400).json({ error: `Missing headers: ${missingHeaders.join(', ')}` });
    }

    // Process rows
    const rows = data.slice(1).filter(row => {
      // Filter out rows where all cells are empty
      return row.some(cell => cell !== null && cell !== undefined && cell.toString().trim() !== '');
    });

    const client = await pool3.connect();
    try {
      await client.query('BEGIN');
      for (const row of rows) {
        const excelreqdate= parseDate(row[headers.req_date]);
        const excelclosedate= parseDate(row[headers.closed_date]);
        const values = [
          row[headers.requirement_id] || 'N/A',
          row[headers.position] || 'N/A',
          row[headers.end_client] || 'N/A',
          row[headers.must_have_skills] || 'N/A',
          row[headers.secondary_skills] || 'N/A',
          row[headers.location] || 'N/A',
          row[headers.experience_range] || 'N/A',
          excelreqdate,
          row[headers.requirement_given_by] || 'N/A',
          row[headers.priority] || 'N/A',
          row[headers.status] || 'N/A',
          row[headers.budget] || null,
          row[headers.no_of_positions] || 0,
          row[headers.time_to_onboard] || 0,
          row[headers.jd_available] === 'TRUE' || false,
          excelclosedate,
          row[headers.submission] || 'N/A',
          row[headers.remarks] || 'N/A',
          row[headers.candidate_name] || 'N/A',
          req.body.userId || null, // Use userId from request body
        ];

        await client.query(
          `INSERT INTO staffing_requirements (
            requirement_id, position, end_client, must_have_skills, secondary_skills,
            location, experience_range, req_date, requirement_given_by, priority, status,
            budget, no_of_positions, time_to_onboard, jd_available, closed_date, submission,
            remarks, candidate_name, userid
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
          values
        );
      }

      await client.query('COMMIT');
      res.status(200).json({ message: 'File uploaded and data saved successfully' });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error inserting data:', error);
      res.status(500).json({ error: 'Failed to save data' });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error processing file:', error);
    res.status(500).json({ error: 'Failed to process file' });
  }
});

// Fetch Leads details
app.get('/api/get-leads', async (req, res) => {
  try {
    const client = await pool3.connect(); // Connect to the PostgreSQL database
    const result = await client.query('SELECT * FROM leads'); // Fetch all records
    client.release(); // Release the connection back to the pool

    res.status(200).json(result.rows); // Return the fetched records as JSON
  } catch (error) {
    console.error('Error fetching records from Leads table:', error);
    res.status(500).json({ error: 'Failed to fetch records from Leads table' });
  }
});

//Fetch Staffing Requirement details
app.get('/api/get-staffing-requirements', async (req, res) => {
  try {
    const client = await pool3.connect(); // Connect to the PostgreSQL database
    const result = await client.query('SELECT * FROM staffing_requirements'); // Fetch all records
    client.release(); // Release the connection back to the pool

    res.status(200).json(result.rows); // Return the fetched records as JSON
  } catch (error) {
    console.error('Error fetching records from staffing_requirements table:', error);
    res.status(500).json({ error: 'Failed to fetch records from staffing_requirements table' });
  }
});
//Update Api for leads and requirement staffing
app.put('/api/dashboard/:userId/:table/:id', async (req, res) => {
  const { userId, table, id } = req.params;
  const updateData = req.body;

  try {
    let query;
    let values;

    if (table === 'leads') {
      query = `
        UPDATE leads
        SET account_name = $1, rpa_platform_user = $2, first_name = $3, last_name = $4,
            titles = $5, contact_no = $6, email_id = $7, linkedin_id = $8, location = $9, remark = $10
        WHERE id = $11
        RETURNING *;
      `;
      values = [
        updateData.account_name,
        updateData.rpa_platform_user,
        updateData.first_name,
        updateData.last_name,
        updateData.titles,
        updateData.contact_no,
        updateData.email_id,
        updateData.linkedin_id,
        updateData.location,
        updateData.remark,
        id
      ];
    } else if (table === 'staffing_requirements') {
      query = `
        UPDATE staffing_requirements
        SET requirement_id = $1, job_id = $2, position = $3, end_client = $4,
            must_have_skills = $5, secondary_skills = $6, location = $7, experience_range = $8,
             requirement_given_by = $9, priority = $10, status = $11,
            budget = $12, no_of_positions = $13, time_to_onboard = $14, submission = $15, remarks = $16, candidate_name = $17
        WHERE id = $18
        RETURNING *;
      `;
      values = [
        updateData.requirement_id,
        updateData.job_id,
        updateData.position,
        updateData.end_client,
        updateData.must_have_skills,
        updateData.secondary_skills,
        updateData.location,
        updateData.experience_range,
        updateData.requirement_given_by,
        updateData.priority,
        updateData.status,
        updateData.budget,
        updateData.no_of_positions,
        updateData.time_to_onboard,
        updateData.submission,
        updateData.remarks,
        updateData.candidate_name,
        id
      ];
    } else {
      return res.status(400).json({ message: 'Invalid table name' });
    }

    const result = await pool3.query(query, values);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Record not found' });
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("Error updating record:", error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete Records
app.delete('/dashboard/:table/:id', async (req, res) => {
  const { userId, table, id } = req.params;
  console.log(" My id received", id);
  // Validate table and id
  if (!['leads', 'staffing_requirements'].includes(table)) {
    return res.status(400).json({ error: 'Invalid table name' });
  }

  try {
    const result = await pool3.query(`DELETE FROM ${table} WHERE id = $1 RETURNING *`, [id]);

    if (result.rowCount > 0) {
      res.status(200).json({ message: 'Record deleted successfully' });
    } else {
      res.status(404).json({ error: 'Record not found' });
    }
  } catch (error) {
    console.error("Error deleting record:", error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// app.get('/api/get-daily-report', async (req, res) => {
//   try {
//     const client = await pool3.connect(); // Connect to the PostgreSQL database
//     const result = await client.query('SELECT * FROM daily_reports'); // Fetch all records
//     client.release(); // Release the connection back to the pool

//     res.status(200).json(result.rows); // Return the fetched records as JSON
//   } catch (error) {
//     console.error('Error fetching records from daily reports table:', error);
//     res.status(500).json({ error: 'Failed to fetch records from daily reports table' });
//   }
// });

app.get('/api/get-daily-report', async (req, res) => {
  try {
    const client = await pool3.connect(); // Connect to the PostgreSQL database

    // Fetch records by joining daily_report and register tables
    const result = await client.query(`
      SELECT daily_reports.*, register.name
      FROM daily_reports
      JOIN register ON daily_reports.userid = register.userid
    `);

    client.release(); // Release the connection back to the pool

    res.status(200).json(result.rows); // Return the fetched records as JSON
  } catch (error) {
    console.error('Error fetching records from daily_report table:', error);
    res.status(500).json({ error: 'Failed to fetch records from daily_report table' });
  }
});

app.get('/api/get-salesteam-names', async (req, res) => {
  try {
    const client = await pool3.connect(); // Connect to the PostgreSQL database
    const result = await client.query('SELECT userid, name, contact_no, email_id from register'); // Fetch all records
    client.release(); // Release the connection back to the pool

    res.status(200).json(result.rows); // Return the fetched records as JSON
  } catch (error) {
    console.error('Error fetching records from register table:', error);
    res.status(500).json({ error: 'Failed to fetch records from from register table' });
  }
});

app.get('/api/get-member-details/:userid', async (req, res) => {
  const { userid } = req.params;

  try {
    const client = await pool3.connect();
    const result = await client.query(
      'SELECT * FROM daily_reports WHERE userid = $1',
      [userid]
    );
    client.release();

    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching member details:', error);
    res.status(500).json({ error: 'Failed to fetch member details' });
  }
});


app.get('(/*)?', function (req, res) {
  res.sendFile(path.join(__dirname, '../project_ui/build/index.html'));
});

// app.listen(port, () => {
//   console.log(`Server app listening at http://10.41.11.10:${port}`);
//   //console.log(`Server app listening at http://localhost:${port}`);
// });

app.listen(port, 'localhost', () => {
  console.log(`✅ Server app running at http://localhost:${port}`);
});
