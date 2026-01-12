import http from 'http';

const ports = [5000, 3001];

const tryPort = (port) => {
    return new Promise((resolve) => {
        console.log(`Trying port ${port}...`);
        const req = http.get(`http://localhost:${port}/api/fix-trials-force`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            // ...
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const json = JSON.parse(data);
                        console.log("--- RESULT ---");
                        console.log("Debug Info:", JSON.stringify(json.debugInfo, null, 2));
                        console.log("Total Users in DB:", json.totalUsersInDb);
                        console.log("Status:", json.success);
                        console.log("Logs:", json.logs.length);
                        console.log("--- END ---");
                    } catch (e) {
                        console.log(`SUCCESS on port ${port}! Response Raw:`, data);
                    }
                    resolve(true);
                } else {
                    console.log(`Port ${port} returned status ${res.statusCode}`);
                    resolve(false);
                }
            });
        });

        req.on('error', (e) => {
            // console.log(`Port ${port} failed: ${e.message}`);
            resolve(false);
        });
    });
};

const run = async () => {
    for (const p of ports) {
        const success = await tryPort(p);
        if (success) {
            console.log("Fix triggered successfully.");
            process.exit(0);
        }
    }
    console.error("Could not find running server with fix endpoint.");
    process.exit(1);
};

run();
