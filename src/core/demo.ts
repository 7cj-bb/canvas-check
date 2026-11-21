import type { AssignmentSnapshot } from './types';

export const DEMO_ASSIGNMENT: AssignmentSnapshot = {
  key: 'demo:course-1:assignment-1', title: 'Number Stats', url: '', source: 'demo', attempt: 'Attempt 1', capturedAt: 0,
  permittedExtensions: ['java', 'png', 'jpg'],
  paragraphs: [
    'Write a Java program to read a sequence of integers and display the largest and smallest values.',
    'Your solution must use a for loop.',
    'Your solution must use the following variables and constants:',
    'LIMIT: the number of integers to read.',
    'smallest: the smallest value entered.',
    'largest: the largest value entered.',
    'Write the pseudocode in a comment at the top of the Java file.',
    'Submit the Java file and the screenshots.',
  ],
  description: '',
};
DEMO_ASSIGNMENT.description = DEMO_ASSIGNMENT.paragraphs.join('\n');

export const SAMPLE_JAVA = `public class NumberStats {
    /* Pseudocode:
       Read the first integer.
       Read the remaining integers and update the smallest and largest values.
       Display both values.
    */
    public static void main(String[] args) {
        final int LIMIT = 10;
        int smallest = 0;
        int largest = 0;
        for (int i = 0; i < LIMIT; i++) {
            System.out.println(i);
        }
    }
}
`;
