#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const glob = require('glob');

// Define the schema for frontmatter validation
const schema = {
  type: 'object',
  required: ['date', 'type'],
  properties: {
    date: {
      type: 'string',
      format: 'date',
      description: 'Meeting date in YYYY-MM-DD format'
    },
    type: {
      type: 'string',
      enum: ['users', 'contributors'],
      description: 'Type of meeting'
    },
    attendees: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'string',
        minLength: 1
      },
      description: 'List of meeting attendees (optional)'
    }
  },
  additionalProperties: false
};

// Initialize validator
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);

/**
 * Convert a date to YYYY-MM-DD format string
 * @param {Date|string} date - The date to format (Date object or string)
 * @returns {string} The date formatted as YYYY-MM-DD
 */
function formatDate(date) {
  if (date instanceof Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(date);
}

/**
 * Validate that the filename contains the date in frontmatter
 * Expected format: filename must contain YYYYMMDD (e.g., YYYYMMDD.md or YYYYMMDD-meeting.md)
 * @param {string} filePath - The full path to the file
 * @param {Date|string} date - The date from frontmatter
 * @returns {{valid: boolean, message?: string}} Validation result
 */
function validateFilename(filePath, date) {
  const filename = path.basename(filePath, '.md');

  // Convert date to YYYY-MM-DD format if it's a Date object
  const dateStr = formatDate(date);

  // Convert date YYYY-MM-DD to YYYYMMDD
  const expectedDate = dateStr.replace(/-/g, '');

  // Check if filename contains the expected date
  if (!filename.includes(expectedDate)) {
    return {
      valid: false,
      message: `Filename "${filename}.md" does not contain date "${expectedDate}" (from frontmatter date "${dateStr}")`
    };
  }

  return { valid: true };
}

/**
 * Validate that the file is in the correct directory based on type
 * Expected: users/YYYY/YYYYMMDD.md for type "users"
 * @param {string} filePath - The full path to the file
 * @param {string} type - The meeting type from frontmatter
 * @param {Date|string} date - The date from frontmatter
 * @returns {{valid: boolean, message?: string}} Validation result
 */
function validateDirectoryStructure(filePath, type, date) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const parts = normalizedPath.split('/');

  // Find the index of the type directory (e.g., "users")
  const typeIndex = parts.findIndex(p => p === type);

  if (typeIndex === -1) {
    return {
      valid: false,
      message: `File should be in "${type}/" directory but found in "${parts.slice(-3, -1).join('/')}"`
    };
  }

  // Convert date to YYYY-MM-DD format if it's a Date object
  const dateStr = formatDate(date);

  // Check if the year directory matches the date
  const year = dateStr.substring(0, 4);
  const yearDirectoryIndex = typeIndex + 1;

  if (yearDirectoryIndex >= parts.length - 1) {
    return {
      valid: false,
      message: `File should be in "${type}/${year}/" directory structure`
    };
  }

  const yearDirectory = parts[yearDirectoryIndex];

  if (yearDirectory !== year) {
    return {
      valid: false,
      message: `File should be in "${type}/${year}/" directory but found in "${type}/${yearDirectory}/"`
    };
  }

  return { valid: true };
}

// Find all markdown files (excluding README.md)
const files = glob.sync('{users,contributors}/**/*.md', {
  cwd: path.resolve(__dirname, '..'),
  absolute: true
});

let hasErrors = false;
const errors = [];

console.log(`Validating ${files.length} files...\n`);

files.forEach(filePath => {
  const relativePath = path.relative(process.cwd(), filePath);
  const fileErrors = [];

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    // Parse frontmatter without automatic date conversion
    const { data: frontmatter, isEmpty } = matter(content);

    // Convert Date objects to strings for validation
    if (frontmatter.date instanceof Date) {
      frontmatter.date = formatDate(frontmatter.date);
    }

    // Check if frontmatter exists
    if (isEmpty || Object.keys(frontmatter).length === 0) {
      fileErrors.push('No frontmatter found');
      errors.push({
        file: relativePath,
        errors: fileErrors
      });
      hasErrors = true;
      return;
    }

    // Validate against schema
    const valid = validate(frontmatter);

    if (!valid) {
      validate.errors.forEach(err => {
        fileErrors.push(`${err.instancePath || '/'}: ${err.message}`);
      });
    }

    // Validate filename matches date
    if (frontmatter.date) {
      const filenameValidation = validateFilename(filePath, frontmatter.date);
      if (!filenameValidation.valid) {
        fileErrors.push(filenameValidation.message);
      }

      // Validate directory structure
      if (frontmatter.type) {
        const directoryValidation = validateDirectoryStructure(filePath, frontmatter.type, frontmatter.date);
        if (!directoryValidation.valid) {
          fileErrors.push(directoryValidation.message);
        }
      }
    }

    if (fileErrors.length > 0) {
      errors.push({
        file: relativePath,
        errors: fileErrors
      });
      hasErrors = true;
    }

  } catch (error) {
    fileErrors.push(`Failed to parse file: ${error.message}`);
    errors.push({
      file: relativePath,
      errors: fileErrors
    });
    hasErrors = true;
  }
});

// Print results
if (hasErrors) {
  console.error('Validation failed!\n');
  errors.forEach(({ file, errors }) => {
    console.error(`File: ${file}`);
    errors.forEach(err => {
      console.error(`  ✗ ${err}`);
    });
    console.error('');
  });
  process.exit(1);
} else {
  console.log('All files validated successfully!');
  process.exit(0);
}
