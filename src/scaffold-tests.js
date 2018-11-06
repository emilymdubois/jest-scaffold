'use strict';

const fs = require('fs');
const path = require('path');
const reactDocs = require('react-docgen');

getFileAndComponentName()
  .then(data => getComponentInfo(data))
  .then(data => getPropDefaults(data))
  .then(data => generateTestCasesContent(data))
  .then(data => generateTestContent(data))
  .then(data => createTestsDir(data))
  .then(data => createTestFiles(data))
  .then(data => printMessage(data))
  .catch(err => formatMessage(err));

/*
Get filepath and component name.
*/
function getFileAndComponentName() {
  return new Promise((resolve, reject) => {
    const filepath = process.argv[2];
    if (!filepath) return reject('Filepath argument is required!');
    const { dir, name } = path.parse(filepath);
    const componentName = name
      .replace(/^[a-z]/, e => e[0].toUpperCase())
      .replace(/_([a-z])/g, e => e[1].toUpperCase());

    // Construct additional directory and filepath names
    const testDirectory = `${dir}/__tests__`;
    const testCasesFile = `${testDirectory}/${name}.test_cases.js`;
    const testFile = `${testDirectory}/${name}.test.js`;

    // Return data object
    resolve({
      componentName,
      componentFilePath: filepath,
      componentFilePathName: name,
      testDirectory,
      testCasesFile,
      testFile
    });
  });
}

/*
Wrapper around the react-docgen parse method. Accepts an optional resolver for
connected components.
*/
function parseComponent(content, resolver) {
  return new Promise(resolve => {
    resolve(reactDocs.parse(content, resolver));
  });
}

/*
Uses parseComponent method to get component information. First, assume the
component is not connected. If that produces an error, try passing a resolver to
the parseComponent method. If that succeeds, prompt the user for the component
name.
*/
function getComponentInfo(data) {
  return new Promise((resolve, reject) => {
    const { componentFilePath } = data;
    const componentContent = fs.readFileSync(componentFilePath).toString();

    // Try parsing and returning content for unconnected component
    parseComponent(componentContent)
      .then(res => {
        data.component = res;
        resolve(data);
      })
      .catch(() => {
        // Try parsing and returning content for connected component
        const resolver = reactDocs.resolver.findAllComponentDefinitions;
        parseComponent(componentContent, resolver)
          .then(res => {
            if (res.length > 1)
              reject(
                'Found more than one component definitions, could not automatically generate tests.'
              );
            data.component = res[0];
            data.wrapped = true;
            resolve(data);
          })
          .catch(() => {
            reject(
              'Failed to analyze component definition, could not automatically generate tests.'
            );
          });
      });
  });
}

/*
For each prop, determine the default value based on the type.
*/
function getPropDefaults(data) {
  return new Promise(resolve => {
    const propTypes = {
      any: `''`,
      boolean: true,
      bool: true,
      Function: 'safeSpy()',
      func: 'safeSpy()',
      'immutable.list': 'Immutable.List()',
      'immutable.map': 'Immutable.Map()',
      number: 0,
      string: `''`,
      union: `''`,
      unknown: 'Immutable.fromJS()'
    };

    data.classifiedProps = [];
    for (const prop in data.component.props) {
      const name = prop;
      const value = data.component.props[prop];

      let message = '';
      let defaultValue, required;

      // Handle for flow types
      if (value.flowType) {
        defaultValue = value.flowType.name;
        if (defaultValue === 'union')
          defaultValue = value.flowType.elements[0].name;
        required = value.required;

        // Handle for React PropTypes
      } else if (value.type.raw) {
        defaultValue = value.type.raw
          .replace(/PropTypes./, '')
          .replace(/.isRequired/, '');
        required = /.isRequired/.test(value.type.raw);

        // Handle all exceptions
      } else {
        defaultValue = 'any';
        message = 'Could not deduce prop type';
      }

      defaultValue = propTypes[defaultValue] || null;
      data.classifiedProps.push({ name, required, defaultValue, message });
    }

    resolve(data);
  });
}

/*
Generate the content for the <component>.test_cases.js file.
*/
function generateTestCasesContent(data) {
  return new Promise(resolve => {
    const { testDirectory } = data;

    // Replace path components with .. to cd up to the root directory
    const safeSpyPrefix = testDirectory.replace(/([^/]*)/g, () => '.');

    data.testCasesContent = [];
    data.requiredProps = data.classifiedProps.filter(p => p.required);
    data.optionalProps = data.classifiedProps.filter(p => !p.required);

    function requiredPropsFormatted(excludeLastComma) {
      data.requiredProps.forEach((prop, i) => {
        const punctuation =
          excludeLastComma && i === data.requiredProps.length - 1 ? '' : ',';
        const comment = prop.message ? ` // message` : '';
        data.testCasesContent.push(
          `    ${prop.name}: ${prop.defaultValue}${punctuation}${comment}`
        );
      });
    }

    function basePropsFormatted() {
      if (!data.component.props) {
        data.testCasesContent.push(
          `  props: {} // could not find prop type declarations`
        );
      } else if (!data.requiredProps.length) {
        data.testCasesContent.push(
          `  props: {} // could not find required props`
        );
      } else {
        data.testCasesContent.push(`  props: {`);
        requiredPropsFormatted(true);
        data.testCasesContent.push(`  }`);
      }
    }

    let wrapped = data.wrapped ? '.WrappedComponent' : '';

    data.testCasesContent.push(`import Immutable from 'immutable';`);
    data.testCasesContent.push(
      `import safeSpy from '${safeSpyPrefix}/test/safe_spy';`
    );
    data.testCasesContent.push(
      `import { ${data.componentName} } from '../${data.componentFilePathName}'`
    );
    data.testCasesContent.push(``);

    data.testCasesContent.push(`export const base = {`);
    data.testCasesContent.push(`  description: 'base',`);
    data.testCasesContent.push(`  component: ${data.componentName}${wrapped},`);
    basePropsFormatted();
    data.testCasesContent.push(`}`);
    data.testCasesContent.push(``);

    data.optionalProps.forEach(optionalProp => {
      const comment = optionalProp.message ? ` // ${optionalProp.message}` : '';
      data.testCasesContent.push(`export const ${optionalProp.name} = {`);
      data.testCasesContent.push(
        `  description: '${optionalProp.name} optional prop',`
      );
      data.testCasesContent.push(
        `  component: ${data.componentName}${wrapped},`
      );
      data.testCasesContent.push(`  props: {`);
      requiredPropsFormatted();
      data.testCasesContent.push(
        `    ${optionalProp.name}: ${optionalProp.defaultValue}${comment}`
      );
      data.testCasesContent.push(`  }`);
      data.testCasesContent.push(`};`);
      data.testCasesContent.push(``);
    });

    resolve(data);
  });
}

/*
Generate the content for the <component>.test.js file.
*/
function generateTestContent(data) {
  return new Promise(resolve => {
    data.testContent = [];
    let testCaseNames = ['base'];
    data.optionalProps.forEach(prop => {
      testCaseNames.push(prop.name);
    });

    data.testContent.push(`import React from 'react';`);
    data.testContent.push(`import { shallow } from 'enzyme';`);
    data.testContent.push(`import toJson from 'enzyme-to-json';`);
    data.testContent.push(
      `import * as testCases from './${data.componentFilePathName}.test_cases';`
    );
    data.testContent.push(``);

    data.testContent.push(`describe('<${data.componentName}>', () => {`);
    data.testContent.push(`  let testCase;`);
    data.testContent.push(`  let wrapper;`);
    data.testContent.push(``);

    testCaseNames.forEach((name, i) => {
      data.testContent.push(
        `  describe(testCases.${name}.description, () => {`
      );
      data.testContent.push(`    beforeEach(() => {`);
      data.testContent.push(`      testCase = testCases.${name};`);
      data.testContent.push(
        `      wrapper = shallow(React.createElement(testCase.component, testCase.props));`
      );
      data.testContent.push(`    });`);
      data.testContent.push(``);
      data.testContent.push(`    it('renders', () => {`);
      data.testContent.push(`      expect(toJson(wrapper)).toMatchSnapshot();`);
      data.testContent.push(`    });`);
      data.testContent.push(`  });`);
      if (i !== testCaseNames.length - 1) data.testContent.push(``);
    });

    data.testContent.push(`});`);
    data.testContent.push(``);
    resolve(data);
  });
}

/*
If a <component_dir>/__tests__ directory does not exist, create one.
*/
function createTestsDir(data) {
  const { testDirectory } = data;
  return new Promise((resolve, reject) => {
    if (fs.existsSync(testDirectory)) resolve(data);
    fs.mkdir(testDirectory, err => {
      if (err) reject(err);
      resolve(data);
    });
  });
}

/*
Stream the <component>.test_cases.js and <component>.test.js content into the
files.
*/
function createTestFiles(data) {
  const { testCasesFile, testFile } = data;
  return new Promise(resolve => {
    const testCasesStream = fs.createWriteStream(testCasesFile);
    testCasesStream.write(data.testCasesContent.join('\n'));
    testCasesStream.close();

    const testStream = fs.createWriteStream(testFile);
    testStream.write(data.testContent.join('\n'));
    testStream.close();

    resolve(data);
  });
}

/*
Print a success message in the console.
*/
function printMessage(data) {
  const { testCasesFile, testFile } = data;
  const message = [
    `Successfully created the following test files for ${data.componentName}:`,
    `  * ${testCasesFile}`,
    `  * ${testFile}`
  ];
  formatMessage(message.join('\n'));
}

/*
Wrapper for printing messages with top and bottom buffers in the console.
*/
function formatMessage(message) {
  console.log(`\n${message}\n`);
}
