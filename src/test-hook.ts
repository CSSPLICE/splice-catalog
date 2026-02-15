import { AppDataSource } from "./src/db/data-source.js";
import { slc_item_catalog } from "./src/db/entities/SLCItemCatalog.js";

async function test() {
    await AppDataSource.initialize();
    console.log("Database connected for test...");

    const newItem = new slc_item_catalog();
    newItem.catalog_type = "Test";
    newItem.persistentID = "hook-test-" + Date.now();
    newItem.platform_name = "TestPlatform";
    newItem.iframe_url = "http://test.com";
    newItem.license = "MIT";
    newItem.description = "Testing the automatic search hook";
    newItem.author = ["Tarini"];
    newItem.institution = ["VT"];
    newItem.keywords = ["test"];
    newItem.features = ["hook"];
    newItem.title = "AUTOMATION SUCCESS TEST";
    newItem.natural_language = ["English"];
    newItem.programming_language = ["Java"];
    newItem.protocol = ["HTTP"];
    newItem.protocol_url = ["http://test.com"];

    console.log("Saving item to trigger hook...");
    await newItem.save(); 
    
    console.log("Done. Check your docker logs for the '✨' message!");
    process.exit(0);
}

test().catch(console.error);